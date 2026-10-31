-- Records the first time each piece of gear (by item GUID) is seen in the
-- player's equipment, bags or bank, and appends those times to the
-- SimulationCraft addon's export as a `# simhammer_acquired=` comment line.

local PRUNE_AFTER = 90 * 24 * 60 * 60 -- forget items not seen for 90 days

local playerKey
local bankOpen = false

local function equipmentLocations()
  local locs = {}
  for slot = INVSLOT_FIRST_EQUIPPED, INVSLOT_LAST_EQUIPPED do
    locs[#locs + 1] = ItemLocation:CreateFromEquipmentSlot(slot)
  end
  return locs
end

local function containerLocations(bags)
  local locs = {}
  for _, bag in ipairs(bags) do
    for slot = 1, C_Container.GetContainerNumSlots(bag) do
      locs[#locs + 1] = ItemLocation:CreateFromBagAndSlot(bag, slot)
    end
  end
  return locs
end

local function bagIds(first, last)
  local ids = {}
  if first and last then
    for bag = first, last do ids[#ids + 1] = bag end
  end
  return ids
end

local function carriedBags()
  return bagIds(Enum.BagIndex.Backpack, NUM_TOTAL_EQUIPPED_BAG_SLOTS)
end

local function characterBankTabs()
  return bagIds(Enum.BagIndex.CharacterBankTab_1, Enum.BagIndex.CharacterBankTab_6)
end

local function warbandBankTabs()
  return bagIds(Enum.BagIndex.AccountBankTab_1, Enum.BagIndex.AccountBankTab_5)
end

-- `owner` is the character holding the item, or "warband" for the shared bank,
-- so the export only lists items this character can actually have.
local function scan(locs, owner)
  local items = SimhammerAcquiredDB.items
  local now = time()
  for _, loc in ipairs(locs) do
    if C_Item.DoesItemExist(loc) then
      local link = C_Item.GetItemLink(loc)
      if link and C_Item.IsEquippableItem(link) then
        local guid = C_Item.GetItemGUID(loc)
        local entry = items[guid]
        if entry then
          entry.link = link -- upgrades change the link but keep the GUID
          entry.last = now
          entry.owner = owner
        else
          items[guid] = { link = link, first = now, last = now, owner = owner }
        end
      end
    end
  end
end

local function scanAll()
  scan(equipmentLocations(), playerKey)
  scan(containerLocations(carriedBags()), playerKey)
  if bankOpen then
    scan(containerLocations(characterBankTabs()), playerKey)
    scan(containerLocations(warbandBankTabs()), "warband")
  end
end

-- Only this character's and warband items: an alt's items can't be seen
-- until that alt logs in, so they must not age out meanwhile.
local function prune()
  local cutoff = time() - PRUNE_AFTER
  for guid, entry in pairs(SimhammerAcquiredDB.items) do
    if (entry.owner == playerKey or entry.owner == "warband") and entry.last < cutoff then
      SimhammerAcquiredDB.items[guid] = nil
    end
  end
end

-- `itemID:bonus1/bonus2/...` with sorted bonus IDs, the same key simhammer
-- derives from a SimC gear line's `id=` and `bonus_id=`.
local function itemKey(link)
  local fields = { strsplit(":", link:match("item:([%-?%d:]+)")) }
  local itemID = fields[1]
  local numBonus = tonumber(fields[13]) or 0
  local bonus = {}
  for i = 1, numBonus do
    bonus[#bonus + 1] = tonumber(fields[13 + i])
  end
  table.sort(bonus)
  return itemID .. ":" .. table.concat(bonus, "/")
end

local function acquiredLine()
  local earliest = {}
  for _, entry in pairs(SimhammerAcquiredDB.items) do
    if entry.owner == playerKey or entry.owner == "warband" then
      local key = itemKey(entry.link)
      if not earliest[key] or entry.first < earliest[key] then
        earliest[key] = entry.first
      end
    end
  end
  local parts = {}
  for key, first in pairs(earliest) do
    parts[#parts + 1] = key .. "@" .. first
  end
  table.sort(parts)
  return "# simhammer_acquired=" .. table.concat(parts, ",")
end

local frame
local function showText(text)
  if not frame then
    frame = CreateFrame("Frame", "SimhammerAcquiredFrame", UIParent, "BasicFrameTemplateWithInset")
    frame:SetSize(700, 450)
    frame:SetPoint("CENTER")
    frame:SetMovable(true)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    frame.TitleText:SetText("Simhammer export")

    local scroll = CreateFrame("ScrollFrame", nil, frame, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", 12, -30)
    scroll:SetPoint("BOTTOMRIGHT", -32, 12)

    local edit = CreateFrame("EditBox", nil, scroll)
    edit:SetMultiLine(true)
    edit:SetAutoFocus(false)
    edit:SetFontObject(ChatFontNormal)
    edit:SetWidth(650)
    edit:SetScript("OnEscapePressed", function() frame:Hide() end)
    scroll:SetScrollChild(edit)
    frame.edit = edit

    tinsert(UISpecialFrames, "SimhammerAcquiredFrame")
  end
  frame.edit:SetText(text)
  frame:Show()
  frame.edit:SetFocus()
  frame.edit:HighlightText()
end

SLASH_SIMHAMMERACQUIRED1 = "/shammer"
SlashCmdList.SIMHAMMERACQUIRED = function()
  if not SimulationcraftAPI then
    print("|cffff5555Simhammer:|r the SimulationCraft addon is required for /shammer.")
    return
  end
  scanAll()
  -- GetSimcProfile is defined with ':' so the API table stands in for self.
  local profile, err = SimulationcraftAPI:GetSimcProfile(false, false, false, false)
  if err then
    print("|cffff5555Simhammer:|r " .. err)
    return
  end
  -- After the checksum line, so SimC's checksum still matches its own text.
  showText(profile .. "\n" .. acquiredLine())
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("BAG_UPDATE_DELAYED")
events:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
events:RegisterEvent("BANKFRAME_OPENED")
events:RegisterEvent("BANKFRAME_CLOSED")
events:SetScript("OnEvent", function(_, event)
  if event == "PLAYER_LOGIN" then
    SimhammerAcquiredDB = SimhammerAcquiredDB or { items = {} }
    playerKey = UnitName("player") .. "-" .. GetNormalizedRealmName()
    prune()
  elseif not playerKey then
    return -- bag events can fire before the saved variables are loaded
  elseif event == "BANKFRAME_OPENED" then
    bankOpen = true
  elseif event == "BANKFRAME_CLOSED" then
    bankOpen = false
    return
  end
  scanAll()
end)

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

// Per-job ring-buffer cap. Holds a long Triage sim's output (~500-1000 lines)
// plus the Staged pipeline, with headroom. ~2000 × ~100 bytes ≈ 200 KB per job.
const MAX_LINES_PER_JOB: usize = 2000;

struct JobLog {
    lines: VecDeque<String>,
    next_index: usize,
    first_index: usize,
    context: Vec<(usize, String)>,
}

impl JobLog {
    fn new() -> Self {
        Self {
            lines: VecDeque::new(),
            next_index: 0,
            first_index: 0,
            context: Vec::new(),
        }
    }
}

pub struct LogBuffer {
    inner: Mutex<HashMap<String, JobLog>>,
}

impl Default for LogBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl LogBuffer {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Append a log line for a job. Ring buffer keeps the last MAX_LINES_PER_JOB lines.
    pub fn push_line(&self, job_id: &str, line: String) {
        let mut map = self.inner.lock().unwrap();
        let log = map.entry(job_id.to_string()).or_insert_with(JobLog::new);
        // Preserve the current run's banner, options and latest baseline even
        // after the rolling console output evicts them. A new stage must not
        // inherit the previous stage's baseline.
        let text = line.trim();
        let prefix = if text.starts_with("SimulationCraft ") {
            log.context.clear();
            Some("SimulationCraft ")
        } else if text.starts_with("Simulating... ") {
            Some("Simulating... ")
        } else if text.starts_with("Generating Baseline: ") {
            Some("Generating Baseline: ")
        } else {
            None
        };
        if let Some(prefix) = prefix {
            log.context
                .retain(|(_, saved)| !saved.trim().starts_with(prefix));
            log.context.push((log.next_index, line.clone()));
        }
        log.lines.push_back(line);
        log.next_index += 1;
        if log.lines.len() > MAX_LINES_PER_JOB {
            log.lines.pop_front();
            log.first_index += 1;
        }
    }

    /// Get log lines with index > `after`. Returns (lines, next_index).
    /// The caller should pass `next` back as `after` on the next call.
    pub fn get_lines_after(&self, job_id: &str, after: usize) -> (Vec<String>, usize) {
        let map = self.inner.lock().unwrap();
        let log = match map.get(job_id) {
            Some(l) => l,
            None => return (Vec::new(), 0),
        };

        if after >= log.next_index {
            return (Vec::new(), log.next_index);
        }

        // `after` is the cursor (last index the client saw); the deque covers
        // [first_index, next_index). Skip past lines already seen.
        let start = after.saturating_sub(log.first_index);

        let mut lines = Vec::new();
        if after < log.first_index {
            // Replay only context missing from the buffer and not previously
            // seen by this cursor. Cursor numbering still refers to raw logs.
            lines.extend(
                log.context
                    .iter()
                    .filter(|(index, _)| *index >= after && *index < log.first_index)
                    .map(|(_, line)| line.clone()),
            );
        }
        lines.extend(log.lines.iter().skip(start).cloned());
        (lines, log.next_index)
    }

    /// Remove all logs for a job (call on completion/failure/cancel).
    pub fn remove(&self, job_id: &str) {
        self.inner.lock().unwrap().remove(job_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnect_retains_baseline_and_setup_after_log_overflow() {
        let logs = LogBuffer::new();
        let context = [
            "SimulationCraft 1210",
            "Simulating... ( threads=16 )",
            "Generating Baseline: Player 1/81 [] 100/100 0 Mean=183044 Error=0.1%",
        ];
        for line in context {
            logs.push_line("job", line.into());
        }
        for i in 0..MAX_LINES_PER_JOB + 5 {
            logs.push_line("job", format!("output {i}"));
        }
        let (lines, next) = logs.get_lines_after("job", 0);
        assert_eq!(&lines[..3], &context);
        assert_eq!(lines.len(), MAX_LINES_PER_JOB + 3);
        assert!(logs.get_lines_after("job", next).0.is_empty());
        // A client which already saw setup doesn't receive it twice.
        assert!(!logs
            .get_lines_after("job", 3)
            .0
            .iter()
            .any(|s| s.starts_with("Generating Baseline:")));
        logs.push_line("other", "unrelated".into());
        assert_eq!(logs.get_lines_after("other", 0).0, vec!["unrelated"]);
    }

    #[test]
    fn new_stage_clears_old_baseline_and_replays_only_latest_baseline() {
        let logs = LogBuffer::new();
        logs.push_line("job", "SimulationCraft old".into());
        logs.push_line("job", "Generating Baseline: old".into());
        logs.push_line("job", "SimulationCraft new".into());
        for i in 0..MAX_LINES_PER_JOB {
            logs.push_line("job", format!("output {i}"));
        }
        assert!(!logs
            .get_lines_after("job", 0)
            .0
            .iter()
            .any(|s| s.contains("old")));
        logs.push_line("job", "Generating Baseline: interim".into());
        logs.push_line("job", "Generating Baseline: final".into());
        for i in 0..MAX_LINES_PER_JOB {
            logs.push_line("job", format!("output {i}"));
        }
        let (lines, _) = logs.get_lines_after("job", 0);
        assert_eq!(lines[0], "SimulationCraft new");
        assert_eq!(lines[1], "Generating Baseline: final");
        logs.remove("job");
        assert!(logs.get_lines_after("job", 0).0.is_empty());
    }
}

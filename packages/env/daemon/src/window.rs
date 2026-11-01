//! Durable's output window (`ShellExecOptions.window`, `ShellOutputInfo.skipped`): undelivered command output is held
//! and coalesced; text followed by more than the window (by a byte or a line) can never be in the caller's tail and is
//! replaced by counts. Delivery follows the caller's commit pace, and waits while an earlier frame is still unsent.

use crate::errors::Failure;
use crate::frame::MAX_PAYLOAD;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

#[derive(Clone, Copy)]
pub struct Window {
    pub max_bytes: usize,
    pub max_lines: usize,
    pub min_interval: Duration,
    pub bytes_per_second: f64,
}

/// Wire milliseconds must fit both a duration and the platform's monotonic clock.
pub fn duration_ms(value: &Value, field: &str) -> Result<Duration, Failure> {
    let invalid = || Failure::new("EINVAL", format!("{field} must be a finite, non-negative duration within the clock range"));
    let ms = value.as_f64().ok_or_else(invalid)?;
    if !ms.is_finite() || ms < 0.0 {
        return Err(invalid());
    }
    let duration = Duration::try_from_secs_f64(ms / 1000.0).map_err(|_| invalid())?;
    Instant::now().checked_add(duration).ok_or_else(invalid)?;
    Ok(duration)
}

impl Window {
    pub fn from_json(json: &Value) -> Result<Option<Window>, Failure> {
        let Some(object) = json.as_object() else { return Ok(None); };
        let min_interval = object.get("minIntervalMs")
            .map(|value| duration_ms(value, "window.minIntervalMs"))
            .transpose()?;
        // Preserve the absent/incomplete window fallback for non-duration fields.
        Ok((|| Some(Window {
            max_bytes: object.get("maxBytes")?.as_u64()? as usize,
            max_lines: object.get("maxLines")?.as_u64()? as usize,
            min_interval: min_interval?,
            bytes_per_second: object.get("bytesPerSecond")?.as_f64()?.max(1.0),
        }))())
    }
}

/// A fragmented delivery may end up to three bytes early at a UTF-8 boundary.
const PROOF_HEADROOM: usize = 4;

#[derive(Default)]
struct Skipped {
    bytes: u64,
    newlines: u64,
    ends_with_newline: bool,
}

/// One output event: its stream, text, and the output omitted right before it.
pub struct Event {
    pub stream: &'static str,
    pub text: String,
    pub skipped: Option<Value>,
}

pub struct Pending {
    window: Window,
    /// Undelivered text in arrival order, by stream.
    segments: Vec<(&'static str, String)>,
    bytes: usize,
    newlines: usize,
    skipped: Option<Skipped>,
    last_send: Instant,
    send_interval: Duration,
}

fn newline_count(text: &str) -> usize {
    text.bytes().filter(|byte| *byte == b'\n').count()
}

impl Pending {
    pub fn new(window: Window) -> Pending {
        Pending {
            window,
            segments: Vec::new(),
            bytes: 0,
            newlines: 0,
            skipped: None,
            last_send: Instant::now(),
            send_interval: Duration::ZERO,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.segments.is_empty()
    }

    /// Remaining pacing delay; elapsed time avoids constructing a potentially overflowing deadline.
    pub fn ready_in(&self, now: Instant) -> Duration {
        self.send_interval.saturating_sub(now.saturating_duration_since(self.last_send))
    }

    pub fn push(&mut self, stream: &'static str, text: String) {
        if text.is_empty() {
            return;
        }
        self.bytes += text.len();
        self.newlines += newline_count(&text);
        match self.segments.last_mut() {
            Some((last, existing)) if *last == stream => existing.push_str(&text),
            _ => self.segments.push((stream, text)),
        }
        // Trimming costs a pass over the held text; do it once a few windows have accumulated.
        // A skip must prove exclusion in the first frame carrying it. Larger windows use ordinary chunks.
        if self.window.max_bytes <= MAX_PAYLOAD - PROOF_HEADROOM
            && (self.bytes > self.window.max_bytes.saturating_add(PROOF_HEADROOM).saturating_mul(4)
                || self.newlines > self.window.max_lines.saturating_add(1).saturating_mul(4))
        {
            self.trim();
        }
    }

    /// Whether the text after a cut still proves the cut text is outside the window.
    fn proves(&self, bytes: usize, newlines: usize) -> bool {
        bytes > self.window.max_bytes || newlines > self.window.max_lines
    }

    /// Replace the longest prefix whose remainder still proves exclusion by counts.
    fn trim(&mut self) {
        let mut removed = String::new();
        // Whole segments first.
        while self.segments.len() > 1 {
            let (bytes, newlines) = {
                let first = &self.segments[0].1;
                (first.len(), newline_count(first))
            };
            if !self.proves(self.bytes - bytes, self.newlines - newlines) {
                break;
            }
            let (_, text) = self.segments.remove(0);
            self.bytes -= bytes;
            self.newlines -= newlines;
            removed.push_str(&text);
        }
        // Then a prefix of the first remaining segment, at a character boundary.
        let rest_bytes = self.bytes - self.segments[0].1.len();
        let rest_newlines = self.newlines - newline_count(&self.segments[0].1);
        let first = &self.segments[0].1;
        let mut cut = 0;
        // By bytes: keep more than `max_bytes` overall.
        let keep_bytes = self.window.max_bytes.saturating_add(PROOF_HEADROOM).saturating_sub(rest_bytes);
        if first.len() > keep_bytes {
            let mut index = first.len() - keep_bytes;
            while index > 0 && !first.is_char_boundary(index) {
                index -= 1;
            }
            cut = cut.max(index);
        }
        // By lines: keep more than `max_lines` newlines overall, starting at a newline of this segment.
        let keep_newlines = self.window.max_lines.saturating_add(1).saturating_sub(rest_newlines);
        if keep_newlines > 0 {
            let positions: Vec<usize> = first
                .bytes()
                .enumerate()
                .filter(|(_, byte)| *byte == b'\n')
                .map(|(index, _)| index)
                .collect();
            if positions.len() >= keep_newlines {
                cut = cut.max(positions[positions.len() - keep_newlines]);
            }
        } else {
            cut = first.len();
        }
        if cut > 0 {
            let first = &mut self.segments[0].1;
            let prefix: String = first.drain(..cut).collect();
            self.bytes -= prefix.len();
            self.newlines -= newline_count(&prefix);
            removed.push_str(&prefix);
            if first.is_empty() {
                self.segments.remove(0);
            }
        }
        if !removed.is_empty() {
            let skipped = self.skipped.get_or_insert_with(Skipped::default);
            skipped.bytes += removed.len() as u64;
            skipped.newlines += newline_count(&removed) as u64;
            skipped.ends_with_newline = removed.ends_with('\n');
        }
    }

    /// Deliver bounded UTF-8 events; the first event carrying a skip contains its exclusion proof.
    pub fn take(&mut self) -> Vec<Event> {
        if self.skipped.is_some() {
            // Keep the proof in one frame even if more output accumulated since the previous trim.
            self.trim();
        }
        let segments = std::mem::take(&mut self.segments);
        let delivered = self.bytes;
        self.bytes = 0;
        self.newlines = 0;
        // The caller writes at most the window per sample, and paces itself by what it wrote.
        let pace = Duration::from_secs_f64(
            delivered.min(self.window.max_bytes) as f64 / self.window.bytes_per_second,
        );
        self.last_send = Instant::now();
        self.send_interval = self.window.min_interval.max(pace);
        let events: Vec<Event> = match self.skipped.take() {
            Some(skipped) => {
                let stream = segments.last().map(|(stream, _)| *stream).unwrap_or("stdout");
                let text: String = segments.into_iter().map(|(_, text)| text).collect();
                vec![Event {
                    stream,
                    text,
                    skipped: Some(json!({
                        "bytes": skipped.bytes,
                        "newlines": skipped.newlines,
                        "endsWithNewline": skipped.ends_with_newline,
                    })),
                }]
            }
            None => segments.into_iter().map(|(stream, text)| Event {
                stream,
                text,
                skipped: None,
            }).collect(),
        };
        if events.iter().all(|event| event.text.len() <= MAX_PAYLOAD) {
            return events;
        }
        let mut fragments = Vec::new();
        for event in events {
            if event.text.len() <= MAX_PAYLOAD {
                fragments.push(event);
                continue;
            }
            let mut text = event.text.as_str();
            let mut skipped = event.skipped;
            while !text.is_empty() {
                let mut end = text.len().min(MAX_PAYLOAD);
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                fragments.push(Event {
                    stream: event.stream,
                    text: text[..end].to_string(),
                    skipped: skipped.take(),
                });
                text = &text[end..];
            }
        }
        fragments
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(max_bytes: usize, max_lines: usize) -> Window {
        Window {
            max_bytes,
            max_lines,
            min_interval: Duration::ZERO,
            bytes_per_second: 1e12,
        }
    }

    #[test]
    fn delivery_is_immediate_then_paced_without_losing_queued_output() {
        for (min_interval, bytes_per_second, interval) in [
            (Duration::ZERO, 1e20, Duration::ZERO),
            (Duration::from_secs(2), 1000.0, Duration::from_secs(2)),
            (Duration::ZERO, 5.0, Duration::from_secs(2)),
        ] {
            let mut pending = Pending::new(Window { min_interval, bytes_per_second, ..window(1000, 1000) });
            pending.push("stdout", "0123456789".into());
            assert!(pending.ready_in(Instant::now()).is_zero());
            let first = pending.take();
            assert_eq!(first[0].text, "0123456789");
            // Observe synthetic times after a real delivery rather than sleeping.
            let sent = pending.last_send;
            assert_eq!(pending.ready_in(sent), interval);
            pending.push("stderr", "queued output".into());
            assert_eq!(pending.ready_in(sent + interval / 2), interval - interval / 2);
            assert!(pending.ready_in(sent + interval).is_zero());
            let queued = pending.take();
            assert_eq!(queued[0].stream, "stderr");
            assert_eq!(queued[0].text, "queued output");
            assert!(queued[0].skipped.is_none());
        }
    }

    #[test]
    fn fragments_large_utf8_output_without_losing_stream_order_or_skip_proof() {
        let mut pending = Pending::new(window(10, usize::MAX / 8));
        let text = "é😀".repeat(crate::frame::MAX_PAYLOAD / 3);
        pending.push("stderr", text.clone());
        let events = pending.take();
        let (bytes, _, after) = total(&events);
        assert_eq!(bytes, text.len() as u64);
        assert!(text.ends_with(&after));
        for event in &events {
            assert!(event.text.len() <= crate::frame::MAX_PAYLOAD);
            assert_eq!(event.stream, "stderr");
            if event.skipped.is_some() {
                assert!(event.text.len() > 10);
            }
        }
    }

    #[test]
    fn oversized_windows_deliver_all_text_in_bounded_ordered_events() {
        let mut pending = Pending::new(window(crate::frame::MAX_PAYLOAD, usize::MAX / 8));
        let stdout = "é😀".repeat(crate::frame::MAX_PAYLOAD);
        pending.push("stdout", stdout.clone());
        pending.push("stderr", "last".into());
        let events = pending.take();
        assert!(events.iter().all(|event| event.skipped.is_none()));
        assert!(events.iter().all(|event| event.text.len() <= crate::frame::MAX_PAYLOAD));
        let actual: String = events.iter().filter(|event| event.stream == "stdout").map(|event| event.text.as_str()).collect();
        assert_eq!(actual, stdout);
        assert_eq!(events.last().unwrap().stream, "stderr");
        assert_eq!(events.last().unwrap().text, "last");
    }

    #[test]
    fn a_skip_on_a_near_frame_sized_window_has_proof_in_its_first_fragment() {
        let max_bytes = crate::frame::MAX_PAYLOAD - 4;
        let mut pending = Pending::new(window(max_bytes, usize::MAX / 8));
        pending.push("stdout", "😀".repeat(crate::frame::MAX_PAYLOAD * 2));
        let events = pending.take();
        assert!(events[0].skipped.is_some());
        assert!(events[0].text.len() > max_bytes);
        assert!(events.iter().all(|event| event.text.len() <= crate::frame::MAX_PAYLOAD));
    }

    /// Bytes and newlines delivered or skipped, and the text after the last skip.
    fn total(events: &[Event]) -> (u64, u64, String) {
        let mut bytes = 0;
        let mut newlines = 0;
        let mut after = String::new();
        for event in events {
            if let Some(skipped) = &event.skipped {
                bytes += skipped["bytes"].as_u64().unwrap();
                newlines += skipped["newlines"].as_u64().unwrap();
                after.clear();
            }
            bytes += event.text.len() as u64;
            newlines += newline_count(&event.text) as u64;
            after.push_str(&event.text);
        }
        (bytes, newlines, after)
    }

    #[test]
    fn counts_everything_and_keeps_more_than_the_window_after_a_skip() {
        let mut pending = Pending::new(window(10, 2));
        let mut full = String::new();
        let mut events = Vec::new();
        for index in 0..500 {
            let text = format!("line {index} é😀\n");
            full.push_str(&text);
            pending.push(if index % 7 == 0 { "stderr" } else { "stdout" }, text);
            if index % 50 == 49 {
                events.extend(pending.take());
            }
        }
        events.extend(pending.take());
        let (bytes, newlines, after) = total(&events);
        assert_eq!(bytes, full.len() as u64);
        assert_eq!(newlines, newline_count(&full) as u64);
        assert!(full.ends_with(&after));
        assert!(after.len() > 10 || newline_count(&after) > 2);
        assert!(events.iter().any(|event| event.skipped.is_some()));
    }

    #[test]
    fn delivers_streams_apart_without_skips() {
        let mut pending = Pending::new(window(1000, 1000));
        pending.push("stdout", "a".into());
        pending.push("stderr", "b".into());
        pending.push("stdout", "c".into());
        let events = pending.take();
        let streams: Vec<_> = events.iter().map(|event| event.stream).collect();
        assert_eq!(streams, ["stdout", "stderr", "stdout"]);
    }
}

// A frame-driven wipe keeps preview motion independent of browser animation APIs.
export function createMaskAnimator({
  duration = 600,
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id),
  now = () => performance.now()
} = {}) {
  function paint(record, progress) {
    record.progress = progress;
    record.element.style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`;
  }
  function progressAt(motion, time) {
    const t = Math.max(0, Math.min(1, (time - motion.start) / motion.duration));
    const eased = t * t * (3 - 2 * t);
    return motion.from + (motion.to - motion.from) * eased;
  }
  function cancel(record) {
    if (record.motion) cancelFrame(record.motion.frame);
    record.motion = null;
  }
  function set(record, visible, animate, onFinish) {
    const time = now();
    if (record.motion) paint(record, progressAt(record.motion, time));
    cancel(record);
    record.visible = visible;
    const target = visible ? 1 : 0;
    if (!animate || record.progress === target) { paint(record, target); onFinish(); return; }
    const motion = {
      start: time, from: record.progress, to: target,
      duration: duration * Math.abs(target - record.progress), frame: null
    };
    record.motion = motion;
    function tick(timestamp) {
      if (record.motion !== motion) return;
      paint(record, progressAt(motion, timestamp));
      if (timestamp - motion.start >= motion.duration) {
        record.motion = null; onFinish();
      } else motion.frame = requestFrame(tick);
    }
    motion.frame = requestFrame(tick);
  }
  return { set, cancel };
}

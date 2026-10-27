export const extraSamples = {
  transcript: { label: 'Academic transcript', type: 'transcript' },
  chat: { label: 'Chat conversation', type: 'chat' }
};
export function drawExtraSample(canvas, kind) {
  const c = canvas.getContext('2d'); canvas.width = 760; canvas.height = 1030;
  const text = (value, x, y, size = 24, color = '#284536', weight = 400) => { c.font = `${weight} ${size}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`; c.fillStyle = color; c.fillText(value, x, y); };
  const box = (x, y, w, h, color = '#edf3e8') => { c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, 12); c.fill(); };
  c.fillStyle = '#fff'; c.fillRect(0, 0, 760, 1030);
  const valueRect = (prefix, value, x, y, size, weight = 400) => {
    c.save(); c.font = `${weight} ${size}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
    const left = x + c.measureText(prefix).width, width = c.measureText(value).width; c.restore();
    return [Math.max(0, Math.floor(left) - 6), Math.max(0, Math.floor(y - size * 1.15)), Math.ceil(width) + 12, Math.ceil(size * 1.5)];
  };
  const fields = [];
  const field = (id, category, name, rect, anchor) => fields.push({ id, category, name, rect, anchor, source: 'sample', userOverride: null });
  if (kind === 'transcript') {
    text('EXAMPLE UNIVERSITY', 56, 76, 34, '#245c49', 600);
    field('university', 'university', 'University', valueRect('', 'EXAMPLE UNIVERSITY', 56, 76, 34, 600), 'EXAMPLE UNIVERSITY');
    text('ACADEMIC TRANSCRIPT', 56, 126, 20, '#62785b', 600);
    text('Student name:', 56, 204, 22); text('Alex Chan', 312, 204, 26);
    field('name', 'name', 'Student name', valueRect('', 'Alex Chan', 312, 204, 26), 'Alex Chan');
    text('Student ID:', 56, 259, 22); text('3030123456', 312, 259, 26);
    field('student-id', 'student_id', 'Student ID', valueRect('', '3030123456', 312, 259, 26), '3030123456');
    text('Date of birth:', 56, 314, 22); text('2004-03-16', 312, 314, 26);
    field('birth-date', 'birth_date', 'Date of birth', valueRect('', '2004-03-16', 312, 314, 26), '2004-03-16');
    box(48, 364, 664, 358);
    text('ACADEMIC RECORD', 70, 402, 17, '#617857', 600);
    ['COMP2396', 'COMP2501', 'MATH3601'].forEach((code, i) => {
      const y = 470 + i * 66;
      text(`Course: ${code}`, 72, y, 25); text(`Grade: ${['A', 'A-', 'A'][i]}`, 510, y, 25);
      field(`course-${i}`, 'course', `Course ${i + 1}`, valueRect('Course: ', code, 72, y, 25), code);
      field(`grade-${i}`, 'grade', `Grade ${i + 1}`, valueRect('Grade: ', ['A', 'A-', 'A'][i], 510, y, 25), ['A', 'A-', 'A'][i]);
    });
    text('CGPA: 3.63 / 4.30', 72, 686, 30, '#245c49', 600);
    field('gpa', 'gpa', 'GPA', valueRect('CGPA: ', '3.63 / 4.30', 72, 686, 30, 600), '3.63 / 4.30');
    text('Email: alex.chan@example.com', 56, 805, 23);
    field('email', 'email', 'Personal email', valueRect('Email: ', 'alex.chan@example.com', 56, 805, 23), 'alex.chan@example.com');
    text('Semester: Autumn 2026', 56, 868, 22, '#657b5d');
    text('Fictional record. Not an official university document.', 56, 920, 20, '#657b5d');
  } else {
    box(0, 0, 760, 112, '#e8f0e3'); text('DemoChat', 48, 69, 33, '#245c49', 600);
    text('CHAT CONVERSATION', 48, 151, 16, '#677c5f', 600);
    text('Name: Alex Chan', 48, 198, 25); field('name', 'name', 'Participant name', valueRect('Name: ', 'Alex Chan', 48, 198, 25), 'Alex Chan');
    text('Phone: +852 5550 0136', 48, 243, 23); field('phone', 'phone', 'Participant phone', valueRect('Phone: ', '+852 5550 0136', 48, 243, 23), '+852 5550 0136');
    text('10:42', 48, 312, 18, '#6d8166');
    box(44, 333, 635, 150); text('Can you help me understand this', 66, 382, 25); text('delivery delay? It has been three days.', 66, 424, 25);
    text('10:43', 48, 531, 18, '#6d8166');
    box(44, 552, 670, 195); text('Private note:', 66, 597, 22, '#657b5d');
    text('I will be away from home all week.', 66, 641, 25);
    field('message', 'private_message', 'Private message', valueRect('', 'I will be away from home all week.', 66, 641, 25), 'I will be away from home all week.');
    text('Door code: 4821', 66, 702, 25);
    field('secret', 'secret', 'Door access code', valueRect('Door code: ', '4821', 66, 702, 25), '4821');
    text('10:44', 48, 795, 18, '#6d8166'); box(160, 818, 550, 80);
    text('Let’s check the public status page.', 181, 867, 24);
    text('Delivered', 594, 927, 18, '#6d8166');
  }
  text('FICTIONAL SAMPLE / FOR DEMONSTRATION ONLY', 106, 990, 15, '#657b5d');
  return fields;
}

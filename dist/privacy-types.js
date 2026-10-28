// Shared browser/server contract. Values are field categories, not policy decisions.
export const categoryNames = {
  order: 'Order number', tracking: 'Tracking number', transaction: 'Payment transaction ID', reference: 'Reference number',
  name: 'Personal name', phone: 'Phone number', address: 'Address', email: 'Email address', payment: 'Payment details',
  id: 'Identity document', account: 'Account identifier', student_id: 'Student ID', birth_date: 'Date of birth',
  university: 'University', course: 'Course', grade: 'Grade', gpa: 'GPA', private_message: 'Private message', secret: 'Access credential', personal_path: 'Personal file path', internal_endpoint: 'Internal network detail', other: 'Sensitive detail'
};
export const textCategories = Object.keys(categoryNames);

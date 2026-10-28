// Ground truth is specified from the fictional source content before OCR. These
// values are disposable test strings, not usable credentials. Never add real data.
const field = (value, category = 'secret') => ({ value, category });
export const fixtures = [
  { id:'terminal', type:'technical_screenshot', rows:[
    '$ npm run start', 'Node.js v22.9.0', 'TypeError: Cannot read properties of undefined',
    '  at loadProfile (app.js:42:7)', 'API_KEY=FAKE_TERMINAL_9x7Q2',
    'User: alex@example.com', 'File: /Users/alex/private-project/config.js',
    'Docs: https://developer.mozilla.org'
  ], fields:[field('FAKE_TERMINAL_9x7Q2'),field('alex@example.com','email'),field('/Users/alex/private-project/config.js','personal_path')], controls:['TypeError: Cannot read properties of undefined','app.js:42:7','Node.js v22.9.0','https://developer.mozilla.org'] },
  { id:'python', type:'technical_screenshot', rows:[
    '$ python main.py', 'Python 3.12.1', 'Traceback (most recent call last):',
    '  File "main.py", line 17', 'ValueError: invalid response', 'password="two synthetic words!"',
    'access_token=FAKE_python_access_42'
  ], fields:[field('two synthetic words!'),field('FAKE_python_access_42')], controls:['Python 3.12.1','File "main.py", line 17','ValueError: invalid response'] },
  { id:'java', type:'technical_screenshot', rows:[
    'java.lang.NullPointerException: missing account', '  at demo.Main.start(Main.java:12)',
    'Java version 21', 'File: /home/river/private/Main.java', 'Email: river@example.com'
  ], fields:[field('/home/river/private/Main.java','personal_path'),field('river@example.com','email')], controls:['NullPointerException','Main.java:12','Java version 21'] },
  { id:'browser-console', type:'technical_screenshot', rows:[
    'POST /api/profile 401 Unauthorized', 'Chrome/130', 'Failed to fetch',
    'Authorization: Bearer FAKE_BEARER_a7b8c9d0', 'Host: build.corp.local',
    'Docs: https://docs.example.org/errors/401'
  ], fields:[field('FAKE_BEARER_a7b8c9d0'),field('build.corp.local','internal_endpoint')], controls:['401 Unauthorized','Chrome/130','https://docs.example.org/errors/401'] },
  { id:'configuration', type:'technical_screenshot', rows:[
    'Node.js v22.9.0', 'Error: database connection refused',
    'DATABASE_URL=postgresql://demo:FAKE_DB_pw77@db.corp.local/app',
    'client_secret=FAKE_client_Secret_78', 'PUBLIC_DOCS=https://developer.mozilla.org'
  ], fields:[field('postgresql://demo:FAKE_DB_pw77@db.corp.local/app'),field('FAKE_client_Secret_78')], controls:['Node.js v22.9.0','Error: database connection refused','https://developer.mozilla.org'] },
  { id:'wrapped', type:'technical_screenshot', rows:[
    'ReferenceError: session is not defined', '  at start (server.js:90:4)',
    'access_token=', 'FAKE_WRAP_alpha77beta88', 'Repeated: FAKE_WRAP_alpha77beta88'
  ], fields:[field('FAKE_WRAP_alpha77beta88'),field('FAKE_WRAP_alpha77beta88')], controls:['ReferenceError: session is not defined','server.js:90:4'] },
  { id:'duplicated', type:'technical_screenshot', rows:[
    '$ npm run debug', 'Error: authentication failed', 'api_key = FAKE_DUPLICATE_99xyz',
    'echo FAKE_DUPLICATE_99xyz', 'echo FAKE_DUPLICATE_99xyz'
  ], fields:[field('FAKE_DUPLICATE_99xyz'),field('FAKE_DUPLICATE_99xyz'),field('FAKE_DUPLICATE_99xyz')], controls:['npm run debug','Error: authentication failed'] },
  { id:'windows', type:'technical_screenshot', rows:[
    'SyntaxError: Unexpected token', '  at parse (config.js:18:2)',
    'File: C:\\Users\\Alex\\Documents\\app.js', 'Password=FAKE_windows_pw72',
    'Version: Node.js v22.9.0'
  ], fields:[field('C:\\Users\\Alex\\Documents\\app.js','personal_path'),field('FAKE_windows_pw72')], controls:['SyntaxError: Unexpected token','config.js:18:2','Node.js v22.9.0'] },
  { id:'network', type:'technical_screenshot', rows:[
    'Error: Connection refused', 'Node.js v22.9.0', 'Host: service.internal',
    'Private endpoint: 192.168.1.10', 'Local test: http://localhost:3000',
    'Public DNS: 8.8.8.8', 'Docs: https://developer.mozilla.org'
  ], fields:[field('service.internal','internal_endpoint'),field('192.168.1.10','internal_endpoint')], controls:['Connection refused','Node.js v22.9.0','http://localhost:3000','8.8.8.8','https://developer.mozilla.org'] },
  { id:'multiple-assignments', type:'technical_screenshot', rows:[
    'HTTP 500 Internal Server Error', 'Node.js v22.9.0',
    'API_KEY=FAKE_first_key77; password=FAKE_second_pw88',
    'GET /status 500', 'Method: fetchProfile app.js:53'
  ], fields:[field('FAKE_first_key77'),field('FAKE_second_pw88')], controls:['HTTP 500 Internal Server Error','Node.js v22.9.0','fetchProfile app.js:53'] },
  { id:'chat-negative', type:'chat', rows:['DemoChat','CHAT CONVERSATION','10:42 Delivered','I got an error yesterday.','The token expired, can you explain it?'], fields:[], controls:['I got an error yesterday.','The token expired, can you explain it?'] },
  { id:'documentation-negative', type:'general', rows:['Public documentation notes','The word token does not imply a credential.','const username = user.name;','Docs: https://developer.mozilla.org'], fields:[], controls:['token does not imply a credential.','const username = user.name;','https://developer.mozilla.org'] },
  { id:'generic-path-negative', type:'general', rows:['Public library location','/usr/lib/node/app.js:42','/opt/tools/bin/start','http://localhost:3000','8.8.8.8'], fields:[], controls:['/usr/lib/node/app.js:42','/opt/tools/bin/start','http://localhost:3000','8.8.8.8'] },
  { id:'random-negative', type:'general', rows:['Public sample output','Value: A7b8c9d0e1f2g3h4i5','Retry count: 3','No account or authentication assignment here.'], fields:[], controls:['A7b8c9d0e1f2g3h4i5','Retry count: 3'] }
];

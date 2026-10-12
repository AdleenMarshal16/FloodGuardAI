// Usage: node setpassword.js rohan NewPassword   (only changes rohan, amaya or adleen)
const fs = require('fs'), crypto = require('crypto'), f = __dirname + '/users.json';
const [name, pw] = [(process.argv[2] || '').toLowerCase(), process.argv[3]], users = JSON.parse(fs.readFileSync(f));
if (!users[name] || !pw || pw.length < 8) { console.log('Usage: node setpassword.js <rohan|amaya|adleen> <password, 8+ characters>'); process.exit(1); }
const salt = crypto.randomBytes(16); users[name].salt = salt.toString('hex'); users[name].hash = crypto.scryptSync(pw, salt, 32).toString('hex');
fs.writeFileSync(f, JSON.stringify(users, null, 2)); console.log('Password updated for ' + name);

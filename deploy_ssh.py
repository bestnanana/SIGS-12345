import paramiko

def check_dept():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('219.223.170.20', username='cy', password='c@Xx503y', timeout=10)
    
    script = '''const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'server/data/app.db'));

const queries = [
  { label: 'admin_departments', sql: "SELECT * FROM department_admin_departments WHERE admin_id=6" },
  { label: 'all_admin_departments', sql: "SELECT dad.*,da.person_id,tp.name FROM department_admin_departments dad LEFT JOIN department_admins da ON dad.admin_id=da.id LEFT JOIN token_persons tp ON tp.id=da.person_id" }
];

for (const q of queries) {
  console.log('=== ' + q.label + ' ===');
  try {
    const rows = db.prepare(q.sql).all();
    console.log(JSON.stringify(rows, null, 2));
  } catch(e) {
    console.log('ERROR: ' + e.message);
  }
  console.log();
}
db.close();'''
    
    stdin, stdout, stderr = client.exec_command(
        f'cat > /opt/sigs-0531/query_dept.js << \'SCRIPT_EOF\'\n{script}\nSCRIPT_EOF',
        timeout=10
    )
    stdout.read()
    
    stdin, stdout, stderr = client.exec_command(
        'cd /opt/sigs-0531 && node query_dept.js',
        timeout=10
    )
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    print(out)
    if err:
        print('ERR:', err)
    
    client.close()

check_dept()

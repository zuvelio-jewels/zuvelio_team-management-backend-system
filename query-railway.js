const { Client } = require('pg');

const DB = 'postgresql://postgres:RZmaBrLsUngFZxIlsuBJdgrIkneFlZCW@caboose.proxy.rlwy.net:58744/railway';

async function run() {
    const client = new Client({ connectionString: DB });
    await client.connect();

    // Users
    const users = await client.query(
        'SELECT id, name, role, "isAssignable" FROM "User" ORDER BY id'
    );
    console.log('\n=== USERS ===');
    users.rows.forEach(u => {
        console.log(`  [${u.id}] ${u.name} | ${u.role} | assignable:${u.isAssignable}`);
    });

    // Task count
    const countRes = await client.query('SELECT COUNT(*) FROM "Task"');
    console.log(`\n=== TASKS (total: ${countRes.rows[0].count}) — latest 100 ===\n`);

    // Tasks
    const tasks = await client.query(`
    SELECT t.id, t."createdAt", t.cabin, t."taskDetail", t."personStatus", t."qcCheck",
           uf.name AS from_name, ut.name AS to_name
    FROM "Task" t
    LEFT JOIN "User" uf ON uf.id = t."allottedFromId"
    LEFT JOIN "User" ut ON ut.id = t."assignedToId"
    ORDER BY t.id DESC LIMIT 100
  `);
    tasks.rows.forEach(r => {
        const dt = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '--';
        const detail = (r.taskDetail || '').substring(0, 45);
        console.log(`[${r.id}] ${dt} | Cabin:${r.cabin || '—'} | From:${r.from_name || '—'} | To:${r.to_name || '—'} | ${detail} | ${r.personStatus} | QC:${r.qcCheck || '—'}`);
    });

    await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });

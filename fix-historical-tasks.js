/**
 * fix-historical-tasks.js
 * 
 * Fixes the historical import where:
 *   - allottedFromId was set to Admin User (ID:4) for all tasks  [WRONG]
 *   - assignedToId was set to the cabin person (requester)        [WRONG]
 * 
 * Correct mapping (from Excel):
 *   - Col 4 = task giver (cabin person)  → allottedFromId
 *   - Col 5 = worker (Dinesh/Kishan)     → assignedToId
 *
 * Run with:  node fix-historical-tasks.js          (dry run - shows what will change)
 *            node fix-historical-tasks.js --apply  (actually updates the DB)
 */

const { Client } = require('pg');

const DB_URL = 'postgresql://postgres:RZmaBrLsUngFZxIlsuBJdgrIkneFlZCW@caboose.proxy.rlwy.net:58744/railway';
const DRY_RUN = !process.argv.includes('--apply');

// ── User ID mapping ───────────────────────────────────────────────────────────
const GIVER_ID = {
    'Jitender Soni': 12,
    'Divya Nankani': 26,
    'Kanhaiya Lal': 17,  // Kanhaiya lal jangid
    'Rashmi Shrimal': 27,
    'Priyanshi Rawat': 25,
    'Chetna Sharma': 29,
    'Ram Sharma': 28,
    'Sanjeev Kumar': 10,
    'Sneha Jain': 21,
    'Priyanka Saraf': 23,
    'Monika Mahena': 22,
    'Pratibha Jaiswal': 13,
    'Vishal Saini': 1,  // Vishal saini
    'Lokesh Bairwa': 19,
    'Deepak Prajapt': 18,  // Deepak Kumar Prajapat
};

const WORKER_ID = {
    'Dinesh Bunkar': 7,
    'Kishan Sain': 9,
};

// ── Excel data (tab-separated columns: excelId, date, cabin, giver, worker, detail) ──
// Source: 102Data.txt attached by user
const EXCEL_ROWS = [
    ['1234', '01-May', '201', 'Jitender Soni', 'Dinesh Bunkar', 'cabin 202 pr label lga de with name of Monika'],
    ['1235', '01-May', '201', 'Jitender Soni', 'Dinesh Bunkar', 'dono washroom mai mug missing hai,, new rakh do'],
    ['1236', '01-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'parcel packing'],
    ['1237', '01-May', '105', 'Kanhaiya Lal', 'Dinesh Bunkar', 'Rhodiyam karvana h'],
    ['1238', '01-May', '105', 'Kanhaiya Lal', 'Dinesh Bunkar', 'marking karvani h'],
    ['1239', '02-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'GOLD LANA HE'],
    ['1240', '02-May', '104', 'Priyanshi Rawat', 'Dinesh Bunkar', '5-6 tik tok pen le ana'],
    ['1241', '02-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'cheque clear karwana he'],
    ['1242', '02-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'parcel packing'],
    ['1243', '02-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'parcel drop at IE'],
    ['1244', '02-May', '105', 'Kanhaiya Lal', 'Dinesh Bunkar', 'lejar karvana h'],
    ['1245', '02-May', '105', 'Kanhaiya Lal', 'Dinesh Bunkar', 'marking karvani h'],
    ['1246', '02-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'cpx from satyaram'],
    ['1247', '02-May', '105', 'Kanhaiya Lal', 'Dinesh Bunkar', 'CPX LAGANI H'],
    ['1248', '02-May', '103', 'Kanhaiya Lal', 'Dinesh Bunkar', 'casting lani hai'],
    ['1249', '04-May', '105', 'Ram Sharma', 'Dinesh Bunkar', 'lasar marking karwani hai'],
    ['1250', '04-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'cre bar se niklne hai'],
    ['1251', '04-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'jindal ji se stone lane he'],
    ['1252', '04-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'stone pick up from nirmal'],
    ['1253', '04-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'tiffin pick up from home'],
    ['1254', '04-May', '105', 'Ram Sharma', 'Dinesh Bunkar', 'marking karwani hai'],
    ['1255', '04-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'parcel packing'],
    ['1256', '04-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', '250/- payment to Blaze'],
    ['1257', '04-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', '#33 silver chain'],
    ['1258', '04-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'nirmal ji ko stone return karna he'],
    ['1259', '04-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'parcel packing'],
    ['1260', '04-May', '201', 'Jitender Soni', 'Dinesh Bunkar', 'painter ko bulana 5th may ko, roof and room mai paint h... meet to me'],
    ['1261', '04-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'stone return parcel pack karna he'],
    ['1262', '04-May', '201', 'Jitender Soni', 'Dinesh Bunkar', 'ground floor purani hr office and uske pass ka cabin ka lock open krke chord de and usme chair, board kuch saaman hai wo sb hata kr room khaali kr de'],
    ['1263', '05-May', '103', 'Kanhaiya Lal', 'Dinesh Bunkar', 'room clean krna h'],
    ['1264', '05-May', '203', 'Sneha Jain', 'Dinesh Bunkar', 'Tissue Box'],
    ['1265', '05-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'parcel packing'],
    ['1266', '05-May', '105', 'Kanhaiya Lal', 'Dinesh Bunkar', 'lejar karvana h'],
    ['1267', '05-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'Tiffin pick up from home'],
    ['1268', '05-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'CPX pick up from satyaram'],
    ['1269', '05-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'CPX pick up from mohit ji'],
    ['1270', '05-May', '105', 'Kanhaiya Lal', 'Dinesh Bunkar', 'lejar karvana h'],
    ['1271', '05-May', '105', 'Kanhaiya Lal', 'Dinesh Bunkar', 'Rhodium karvana h'],
    ['1272', '05-May', '105', 'Kanhaiya Lal', 'Kishan Sain', 'Micron +rhodium sitapura'],
    ['1273', '05-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'Return parcel pack karna he'],
    ['1274', '05-May', '206', 'Sanjeev Kumar', 'Dinesh Bunkar', 'room clean krna h'],
    ['1275', '05-May', '104', 'Divya Nankani', 'Kishan Sain', 'parcel pack and drop gpo urgent'],
    ['1276', '05-May', '105', 'Kanhaiya Lal', 'Dinesh Bunkar', 'cpx lagani h casting pr'],
    ['1277', '05-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'nirmal ji se stone lane he'],
    ['1278', '06-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'Tiffin pick up from home @ 12.30pm'],
    ['1279', '06-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'Tissue box at 104'],
    ['1280', '06-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'CPX pick up from satyaram'],
    ['1281', '06-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'jindal ji se stone lane he'],
    ['1282', '06-May', '202', 'Monika Mahena', 'Kishan Sain', 'room clean krna h'],
    ['1283', '06-May', '', 'Pratibha Jaiswal', 'Dinesh Bunkar', 'Bhaiya please clean the room'],
    ['1284', '06-May', '203', 'Vishal Saini', 'Kishan Sain', 'Bhaiya 2 diary dena , please'],
    ['1285', '06-May', '105', 'Kanhaiya Lal', 'Kishan Sain', 'lejar karvana h'],
    ['1286', '06-May', '105', 'Kanhaiya Lal', 'Kishan Sain', 'marking karvani h'],
    ['1287', '06-May', '206', 'Sanjeev Kumar', 'Kishan Sain', 'colored paper'],
    ['1288', '06-May', '105', 'Kanhaiya Lal', 'Kishan Sain', 'silver ki cating lani h'],
    ['1289', '06-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'PARCEL PACKING'],
    ['1290', '06-May', '104', 'Chetna Sharma', 'Kishan Sain', 'bisleri water bottle'],
    ['1291', '06-May', '105', 'Kanhaiya Lal', 'Kishan Sain', 'cpx lagani h casting pr'],
    ['1292', '06-May', '105', 'Kanhaiya Lal', 'Kishan Sain', 'lejar karvana h'],
    ['1293', '06-May', '203', 'Sneha Jain', 'Kishan Sain', 'cleaning in cabin'],
    ['1294', '06-May', '105', 'Kanhaiya Lal', 'Kishan Sain', 'marking karvani h'],
    ['1295', '06-May', '104', 'Chetna Sharma', 'Kishan Sain', 'Stone pick up from Saim'],
    ['1296', '06-May', '104', 'Divya Nankani', 'Kishan Sain', 'paper for printer'],
    ['1297', '06-May', '103', 'Priyanka Saraf', 'Kishan Sain', 'tissue box'],
    ['1298', '07-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'tiffin from Home'],
    ['1299', '07-May', '105', 'Kanhaiya Lal', 'Kishan Sain', 'casting lana h Radha govind s'],
    ['1300', '07-May', '206', 'Sanjeev Kumar', 'Kishan Sain', 'tissue box'],
    ['1301', '07-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'cheque clear karwana he'],
    ['1302', '07-May', '103', 'Priyanka Saraf', 'Kishan Sain', 'Need lunch'],
    ['1303', '07-May', '105', 'Ram Sharma', 'Dinesh Bunkar', 'marking karwani hai'],
    ['1304', '07-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'jindal ji se stone lane he'],
    ['1305', '07-May', '105', 'Ram Sharma', 'Dinesh Bunkar', 'marking karwani hai'],
    ['1306', '07-May', '105', 'Ram Sharma', 'Dinesh Bunkar', 'lasar karwana hai'],
    ['1307', '07-May', '201', 'Jitender Soni', 'Kishan Sain', 'new machine setup krni h, near gate - talk to me'],
    ['1308', '08-May', '105', 'Ram Sharma', 'Kishan Sain', 'lasar karwana hai'],
    ['1309', '08-May', '105', 'Ram Sharma', 'Kishan Sain', 'cloth clean karna'],
    ['1310', '08-May', '105', 'Ram Sharma', 'Dinesh Bunkar', 'rhodium karwana hai'],
    // Note: 1311 is missing in the original Excel
    ['1312', '08-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'cpx from satyaram'],
    ['1313', '08-May', '105', 'Ram Sharma', 'Dinesh Bunkar', 'lasar karwana hai'],
    ['1314', '08-May', '105', 'Ram Sharma', 'Kishan Sain', 'rhodium karwana hai'],
    ['1315', '08-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'cheque clear karwana he'],
    ['1316', '08-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'parcel packing'],
    ['1317', '08-May', '105', 'Ram Sharma', 'Kishan Sain', 'marking karwana hai'],
    ['1318', '08-May', '206', 'Sanjeev Kumar', 'Kishan Sain', 'I need to perform a nomination on the ring sizer.'],
    ['1319', '08-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'PARCEL PACKING'],
    ['1320', '08-May', '104', 'Divya Nankani', 'Kishan Sain', 'RING SIZE  LIMENATION'],
    ['1321', '08-May', '105', 'Ram Sharma', 'Kishan Sain', 'rhodium karwana hai'],
    ['1322', '08-May', '104', 'Rashmi Shrimal', 'Kishan Sain', 'tambhi ji se stone lane he'],
    ['1323', '08-May', '105', 'Ram Sharma', 'Kishan Sain', 'casting lagani hai'],
    ['1324', '08-May', '105', 'Ram Sharma', 'Kishan Sain', 'lasar karwana hai'],
    ['1325', '08-May', '104', 'Divya Nankani', 'Dinesh Bunkar', '2nd screen not working please check'],
    ['1326', '08-May', '104', 'Divya Nankani', 'Kishan Sain', 'pen packed'],
    ['1327', '08-May', '203', 'Sneha Jain', 'Dinesh Bunkar', '1  dairy'],
    ['1328', '09-May', '202', 'Monika Mahena', 'Kishan Sain', 'tissue box'],
    ['1329', '09-May', '104', 'Divya Nankani', 'Kishan Sain', 'ask locial courier parnter for item dispatch'],
    ['1330', '09-May', '103', 'Lokesh Bairwa', 'Kishan Sain', 'Need to lunch'],
    ['1331', '09-May', '104', 'Chetna Sharma', 'Kishan Sain', 'tiffin from Home'],
    ['1332', '09-May', '104', 'Chetna Sharma', 'Kishan Sain', 'Stones from Nirmal ji'],
    ['1333', '09-May', '104', 'Chetna Sharma', 'Kishan Sain', 'Cpx from satyaram'],
    ['1334', '09-May', '103', 'Deepak Prajapt', 'Kishan Sain', 'Need to new mouse'],
    ['1335', '09-May', '104', 'Divya Nankani', 'Kishan Sain', 'parcel packing and drop on  point after lunch'],
    ['1336', '09-May', '104', 'Chetna Sharma', 'Kishan Sain', '#129 E- 17 inch curb chain &  lock'],
    ['1337', '09-May', '105', 'Ram Sharma', 'Kishan Sain', 'lasar marking karwani hai'],
    ['1338', '09-May', '105', 'Ram Sharma', 'Kishan Sain', 'casting lani hai'],
    ['1339', '09-May', '105', 'Ram Sharma', 'Kishan Sain', 'lasar karwana hai'],
    ['1340', '09-May', '104', 'Rashmi Shrimal', 'Kishan Sain', 'nirmal ji ko stone return karna he'],
    ['1341', '09-May', '105', 'Ram Sharma', 'Kishan Sain', 'rhodium karwana hai'],
    ['1342', '09-May', '105', 'Ram Sharma', 'Kishan Sain', 'casting lagani hai'],
    ['1343', '09-May', '104', 'Rashmi Shrimal', 'Kishan Sain', 'jindal ji se stone lane he'],
    ['1344', '09-May', '105', 'Ram Sharma', 'Kishan Sain', 'lasar karwana hai'],
    ['1345', '11-May', '105', 'Ram Sharma', 'Dinesh Bunkar', 'marking karwani hai'],
    ['1346', '11-May', '206', 'Sanjeev Kumar', 'Kishan Sain', 'Acetone / Di moda'],
    ['1347', '11-May', '202', 'Monika Mahena', 'Kishan Sain', 'dustbin chiye room me'],
    ['1348', '11-May', '103', 'Kanhaiya Lal', 'Kishan Sain', 'Need to lunch'],
    ['1349', '11-May', '105', 'Ram Sharma', 'Kishan Sain', 'lasar karwana hai'],
    ['1350', '11-May', '201', 'Jitender Soni', 'Kishan Sain', 'bijli ka kaam pending kyu h?'],
    ['1351', '11-May', '202', 'Monika Mahena', 'Kishan Sain', 'need room spray'],
    ['1352', '11-May', '105', 'Ram Sharma', 'Kishan Sain', 'casting lani hai'],
    ['1353', '11-May', '105', 'Ram Sharma', 'Kishan Sain', 'rhodium karwana hai'],
    ['1354', '11-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'parcel packing'],
    ['1355', '11-May', '104', 'Divya Nankani', 'Kishan Sain', 'box for  Bracelet'],
    ['1356', '11-May', '104', 'Chetna Sharma', 'Kishan Sain', 'Cpx from satyaram'],
    ['1357', '11-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'tiffin from Home'],
    ['1358', '11-May', '105', 'Ram Sharma', 'Kishan Sain', 'marking karwana hai'],
    ['1359', '11-May', '105', 'Ram Sharma', 'Kishan Sain', 'cpx lagana hai casting per'],
    ['1360', '11-May', '105', 'Ram Sharma', 'Kishan Sain', 'marking karwana hai'],
    ['1361', '11-May', '104', 'Chetna Sharma', 'Kishan Sain', 'Cpx from satyaram'],
    ['1362', '12-May', '104', 'Divya Nankani', 'Kishan Sain', '104 room ka towel  show karna hai'],
    ['1363', '12-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'CHEQUE CLEAR KARWANA HE'],
    ['1364', '12-May', '105', 'Ram Sharma', 'Kishan Sain', '2*4 polly bag lana haI'],
    ['1365', '12-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'PARCEL PACKING AFTER LUNCH'],
    ['1366', '12-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'Tiffin from home'],
    ['1367', '12-May', '203', 'Sneha Jain', 'Kishan Sain', 'Bring laptop chager'],
    ['1368', '12-May', '105', 'Ram Sharma', 'Kishan Sain', 'MARKING KARWANA HAI'],
    ['1369', '12-May', '104', 'Divya Nankani', 'Dinesh Bunkar', 'printer ribon  shi kanri hai  urgent'],
    ['1370', '12-May', '103', 'Priyanka Saraf', 'Kishan Sain', '1 red & 1 black pen'],
    ['1371', '12-May', '105', 'Ram Sharma', 'Kishan Sain', 'casting lagani hai'],
    ['1372', '12-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'Anil ji ko stone return karne he'],
    ['1373', '12-May', '105', 'Ram Sharma', 'Kishan Sain', 'rhodium karwana hai'],
    ['1374', '12-May', '104', 'Rashmi Shrimal', 'Dinesh Bunkar', 'stone parcel pack karna he'],
    ['1375', '13-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'Change display- ask jayant sir'],
    ['1376', '13-May', '104', 'Chetna Sharma', 'Dinesh Bunkar', 'vrat lassi'],
];

async function main() {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    console.log(`\n🔗 Connected to Railway DB`);
    console.log(`🔍 Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : '⚡ LIVE UPDATE'}\n`);

    // Fetch all historical tasks (allottedFromId = 4 = Admin User), order by id ASC
    const res = await client.query(
        `SELECT t.id, t."taskDetail", t."allottedFromId", t."assignedToId",
            uf.name AS from_name, ut.name AS to_name
     FROM "Task" t
     LEFT JOIN "User" uf ON uf.id = t."allottedFromId"
     LEFT JOIN "User" ut ON ut.id = t."assignedToId"
     WHERE t."allottedFromId" = 4
     ORDER BY t.id ASC`
    );

    const dbTasks = res.rows;
    console.log(`📋 Historical tasks in DB (allottedFrom = Admin User): ${dbTasks.length}`);
    console.log(`📋 Excel rows to process: ${EXCEL_ROWS.length}\n`);

    if (dbTasks.length !== EXCEL_ROWS.length) {
        console.warn(`⚠️  Count mismatch! DB: ${dbTasks.length}, Excel: ${EXCEL_ROWS.length}`);
        console.warn('   Will process up to min(dbTasks, excelRows) pairs.\n');
    }

    const pairs = Math.min(dbTasks.length, EXCEL_ROWS.length);
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const missingGivers = new Set();

    for (let i = 0; i < pairs; i++) {
        const db = dbTasks[i];
        const [excelId, , , giverName, workerName, excelDetail] = EXCEL_ROWS[i];

        const newAllottedFromId = GIVER_ID[giverName];
        const newAssignedToId = WORKER_ID[workerName];

        if (!newAllottedFromId) {
            missingGivers.add(giverName);
            console.warn(`  [DB:${db.id}] ❌ Unknown giver: "${giverName}" — skipping`);
            errors++;
            continue;
        }
        if (!newAssignedToId) {
            console.warn(`  [DB:${db.id}] ❌ Unknown worker: "${workerName}" — skipping`);
            errors++;
            continue;
        }

        const detailPreview = (db.taskDetail || '').substring(0, 40).trim();

        if (DRY_RUN) {
            console.log(
                `  [DB:${String(db.id).padEnd(3)}] Excel:${excelId} | ` +
                `FROM: "Admin User" → "${giverName}" (${newAllottedFromId}) | ` +
                `TO: "${db.to_name}" → "${workerName}" (${newAssignedToId}) | ` +
                `"${detailPreview}"`
            );
            updated++;
        } else {
            try {
                await client.query(
                    `UPDATE "Task" SET "allottedFromId" = $1, "assignedToId" = $2 WHERE id = $3`,
                    [newAllottedFromId, newAssignedToId, db.id]
                );
                console.log(
                    `  ✅ [${db.id}] ${giverName} → ${workerName} | "${detailPreview}"`
                );
                updated++;
            } catch (e) {
                console.error(`  ❌ [${db.id}] Update failed: ${e.message}`);
                errors++;
            }
        }
    }

    console.log('\n─────────────────────────────────────────');
    console.log(`✅ ${DRY_RUN ? 'Would update' : 'Updated'}: ${updated} tasks`);
    if (errors > 0) console.log(`❌ Errors/skipped: ${errors}`);
    if (missingGivers.size > 0) console.log(`⚠️  Unknown givers: ${[...missingGivers].join(', ')}`);
    console.log(`─────────────────────────────────────────\n`);

    if (DRY_RUN) {
        console.log('💡 To apply changes, run:  node fix-historical-tasks.js --apply\n');
    }

    await client.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

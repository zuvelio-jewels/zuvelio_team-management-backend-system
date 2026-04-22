# 🗄️ Database Backup & Restore Setup Guide

## 📋 Prerequisites

You need **PostgreSQL CLI tools** installed on your Windows system for `pg_dump` and `psql` commands.

### Step 1: Install PostgreSQL

1. Download and install PostgreSQL from: https://www.postgresql.org/download/windows/
2. During installation, make note of the installation path (typically `C:\Program Files\PostgreSQL\15\`)
3. Make sure **Command Line Tools** are included

### Step 2: Add PostgreSQL to PATH

1. Open **Environment Variables**:
   - Windows 10/11: Press `Win + R` → type `sysdm.cpl` → Press Enter
   - Go to **Advanced** tab → Click **Environment Variables**

2. Under **System variables**, find **Path** → Click **Edit**

3. Click **New** and add the PostgreSQL bin directory:
   ```
   C:\Program Files\PostgreSQL\15\bin
   ```

4. Click **OK** → **OK** → **OK**

5. Verify installation by opening a new PowerShell and running:
   ```powershell
   pg_dump --version
   ```

---

## 🔧 Configuration

### Step 1: Update `.env` File

In the `.env` file, add your Railway database URL:

```env
# For Railway deployment, use DATABASE_PUBLIC_URL for pg_dump backups
DATABASE_PUBLIC_URL=postgresql://postgres:your_password@your_railway_host:5432/your_dbname
```

**Where to find this?**
- Go to Railway dashboard
- Select your PostgreSQL plugin
- Copy the **Public URL** or **DATABASE_URL**

---

## 🚀 Using Backup Commands

### Manual Backup

```powershell
npm run db:backup
```

**Output example:**
```
🔄 Starting database backup...
📅 Backup file: backup_2026-04-22_10-30-45-123-Z.sql
✅ Backup completed successfully!
📊 File size: 2.45 MB
💾 Location: c:\path\to\project\backups\backup_2026-04-22_10-30-45-123-Z.sql
🗑️  Deleted old backup: backup_2026-04-15_08-20-30-456-Z.sql
📌 No old backups to delete (keeping backups from last 7 days)
📂 Total backups: 3
```

### List Available Backups

```powershell
npm run db:restore
```

This shows all available backups without restoring.

### Restore from Backup

```powershell
npm run db:restore backup_2026-04-22_10-30-45-123-Z.sql
```

**It will ask for confirmation:**
```
⚠️  WARNING: This will restore database from backup!
📅 File: backup_2026-04-22_10-30-45-123-Z.sql
📊 Size: 2.45 MB

🔴 This will OVERWRITE the current database!
Type "YES" to confirm restore: 
```

---

## ⏰ Automate Backups (Windows Task Scheduler)

### Step 1: Open Task Scheduler

1. Press `Win + R` → type `taskschd.msc` → Press Enter
2. Right-click on **Task Scheduler Library** → **Create Basic Task**

### Step 2: Configure Task

**General Tab:**
- **Name:** `Zuvelio DB Backup`
- **Description:** `Daily automated PostgreSQL backup`
- ✅ Check: **Run whether user is logged in or not**
- ✅ Check: **Run with highest privileges**

### Step 3: Set Trigger

Click **Triggers** tab → **New**

- **Begin the task:** At a scheduled time
- **Settings:** Daily
- **Time:** 02:00 (2 AM)
- ✅ Check: **Enabled**
- Click **OK**

### Step 4: Set Action

Click **Actions** tab → **New**

- **Action:** Start a program
- **Program/script:** `node`
- **Add arguments (optional):** `backup.js`
- **Start in (optional):** 
  ```
  C:\zuvelio-managment-project\zuvelioteam-management-backend
  ```

Example:
```
Program: C:\Program Files\nodejs\node.exe
Arguments: backup.js
Start in: C:\zuvelio-managment-project\zuvelioteam-management-backend
```

### Step 5: Set Conditions (Optional)

Click **Conditions** tab:
- ✅ Check: **Start the task only if the computer is on AC power**
- ✅ Check: **Wake the computer to run this task**

### Step 6: Finish

Click **OK** → Enter your Windows password if prompted

---

## 🧪 Test Your Setup

### 1. Test pg_dump Access

```powershell
$env:DATABASE_PUBLIC_URL = "postgresql://..."
pg_dump $env:DATABASE_PUBLIC_URL > test_backup.sql
```

### 2. Run Backup Manually

```powershell
npm run db:backup
```

### 3. Check Backup File

```powershell
ls backups/
```

### 4. Test Restore (on test database first!)

```powershell
npm run db:restore
```

---

## 📊 Backup Strategy

### Retention Policy
- **Keep:** Last 7 days of backups
- **Rotate:** Automatically deletes backups older than 7 days
- **Total backups:** Typically 7-10 files depending on backup size

### Backup Timing
- **Frequency:** Daily at 2 AM
- **Duration:** ~5-15 minutes (depends on database size)
- **Size:** ~2-5 MB for typical database

### Storage

Backups are stored locally in:
```
./backups/backup_YYYY-MM-DD_HH-MM-SS-mmm-Z.sql
```

Example structure:
```
backups/
├── .gitkeep
├── backup_2026-04-22_10-30-45-123-Z.sql (2.3 MB)
├── backup_2026-04-21_02-00-00-000-Z.sql (2.1 MB)
├── backup_2026-04-20_02-00-00-000-Z.sql (2.2 MB)
└── ...
```

---

## 🆘 Troubleshooting

### Error: "pg_dump not found"

**Solution:**
1. Verify PostgreSQL is installed: `pg_dump --version`
2. Verify PostgreSQL bin is in PATH:
   ```powershell
   echo $env:Path | Select-String "PostgreSQL"
   ```
3. Restart PowerShell after adding to PATH
4. If still not found, add manually:
   ```powershell
   $env:PATH += ";C:\Program Files\PostgreSQL\15\bin"
   ```

### Error: "DATABASE_URL not set"

**Solution:**
- Ensure `.env` file has `DATABASE_PUBLIC_URL` set
- For local backups, use `DATABASE_URL` instead
- Verify no typos in variable names

### Error: "psql: FATAL connection refused"

**Solution:**
- Verify database URL is correct
- Check if database server is running
- Try connecting manually:
  ```powershell
  psql -U postgres -h your_host -d your_database
  ```

### Backup file is empty

**Solution:**
- Check database credentials in `.env`
- Verify PostgreSQL is running
- Check logs for detailed error messages
- Try backup manually with debug:
  ```powershell
  pg_dump "YOUR_DATABASE_URL" -v
  ```

### Task Scheduler not running backups

**Solution:**
1. Open Task Scheduler
2. Find "Zuvelio DB Backup" task
3. Right-click → **Run** (manual test)
4. Check **History** tab for errors
5. Verify Node.js path is correct
6. Ensure script path is absolute, not relative

---

## 📝 Logs & Monitoring

### View Backup Logs

Check the latest backup output:

```powershell
# List backups sorted by date
ls backups/ | sort -Descending -Property LastWriteTime

# Get file sizes
ls backups/ -File | Format-Table Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB, 2)}}
```

### Windows Event Viewer

To view Task Scheduler execution logs:
1. Open **Event Viewer** (`eventvwr.msc`)
2. Navigate to: **Windows Logs** → **System**
3. Search for "Task Scheduler" events
4. Filter for "Zuvelio DB Backup"

---

## 🔐 Security Best Practices

1. **Never commit backups to git**
   - Backups are already in `.gitignore`

2. **Secure your `.env` file**
   - Don't share database credentials
   - Add `.env` to `.gitignore` (already done)

3. **Rotate credentials periodically**
   - Change database passwords monthly
   - Update `.env` accordingly

4. **Keep backups local and secure**
   - For production, consider offsite backup storage
   - Use encrypted storage for sensitive data

---

## 📞 Quick Reference

```bash
# Backup database
npm run db:backup

# List & restore backups
npm run db:restore

# List backups with sizes
ls backups/ -File | Format-Table Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB, 2)}}

# Check backup logs
Get-Content backup_error.log
```

---

## ✅ Next Steps

1. ✅ Install PostgreSQL
2. ✅ Add PostgreSQL to PATH
3. ✅ Configure `DATABASE_PUBLIC_URL` in `.env`
4. ✅ Test `npm run db:backup`
5. ✅ Set up Windows Task Scheduler
6. ✅ Test scheduled backup manually
7. ✅ Monitor first automated backup

🎉 **You're production-ready!**

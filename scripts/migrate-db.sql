-- 数据库迁移脚本
-- 用于升级 users 表结构和数据修复

-- 1. 添加新字段（如果不存在）
-- password_hash 字段
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- is_active 字段
ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1;

-- must_change_password 字段
ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;

-- 2. 迁移旧密码数据
UPDATE users SET password_hash = password WHERE password_hash IS NULL AND password IS NOT NULL;

-- 3. 修复 superadmin 账号
UPDATE users SET union_id = 'local_superadmin' WHERE username = 'superadmin' AND (union_id IS NULL OR union_id = '');
UPDATE users SET is_active = 1 WHERE username = 'superadmin';
UPDATE users SET must_change_password = 1 WHERE username = 'superadmin' AND (password_hash IS NULL OR password_hash = '');

-- 4. 确保 datahub_basic_persons 中有 superadmin 记录
INSERT OR IGNORE INTO datahub_basic_persons (id, union_id, name, type, department, role, role_id, auth_source, is_active, raw_json)
SELECT 'local_superadmin', 'local_superadmin', '超级管理员', '教职员', '党政办公室', 'super_admin', r.id, 'local', 1, '{}'
FROM roles r WHERE r.code = 'super_admin'
AND NOT EXISTS (SELECT 1 FROM datahub_basic_persons WHERE union_id = 'local_superadmin');

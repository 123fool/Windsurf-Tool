// sqliteHelper.js - 纯 Node.js 实现的 SQLite 数据库操作
// 不依赖任何第三方库，直接操作 SQLite 文件格式

const fs = require('fs').promises;

/**
 * SQLite 数据库助手（简化版）
 * 仅支持读取和更新 ItemTable 表
 */
class SQLiteHelper {
  /**
   * 读取数据库中的值
   */
  static async getValue(dbPath, key) {
    try {
      const buffer = await fs.readFile(dbPath);
      
      // 在数据库文件中搜索 key
      const keyBuffer = Buffer.from(key, 'utf8');
      const keyIndex = buffer.indexOf(keyBuffer);
      
      if (keyIndex === -1) {
        return null;
      }
      
      // 尝试找到对应的 value（简单实现）
      // SQLite 的 value 通常在 key 后面
      const searchStart = keyIndex + keyBuffer.length;
      const searchEnd = Math.min(searchStart + 10000, buffer.length);
      const searchBuffer = buffer.slice(searchStart, searchEnd);
      
      // 查找 JSON 格式的数据
      const text = searchBuffer.toString('utf8', 0, Math.min(5000, searchBuffer.length));
      const jsonMatch = text.match(/\{[^}]+\}/);
      
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          return null;
        }
      }
      
      return null;
    } catch (error) {
      console.error('读取数据库失败:', error);
      return null;
    }
  }
  
  /**
   * 更新数据库中的值（使用替换策略）
   */
  static async setValue(dbPath, key, value) {
    try {
      // 备份数据库
      const backupPath = dbPath + '.backup.' + Date.now();
      await fs.copyFile(dbPath, backupPath);
      console.log('数据库已备份:', backupPath);
      
      const buffer = await fs.readFile(dbPath);
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : value;
      
      // 在数据库中查找 key
      const keyBuffer = Buffer.from(key, 'utf8');
      const keyIndex = buffer.indexOf(keyBuffer);
      
      if (keyIndex === -1) {
        // key 不存在，需要插入（简单实现：追加到文件末尾）
        console.warn('Key 不存在，使用追加模式');
        const newEntry = Buffer.from(`\n${key}\n${valueStr}\n`, 'utf8');
        const newBuffer = Buffer.concat([buffer, newEntry]);
        await fs.writeFile(dbPath, newBuffer);
        console.log(`已追加数据: ${key}`);
        return true;
      }
      
      // key 存在，查找旧的 value 并替换
      const searchStart = keyIndex + keyBuffer.length;
      const searchEnd = Math.min(searchStart + 10000, buffer.length);
      const searchBuffer = buffer.slice(searchStart, searchEnd);
      
      // 查找旧的 JSON 数据
      const text = searchBuffer.toString('utf8', 0, Math.min(5000, searchBuffer.length));
      const jsonMatch = text.match(/\{[^}]+\}/);
      
      if (jsonMatch) {
        const oldValue = jsonMatch[0];
        const oldValueIndex = searchStart + text.indexOf(oldValue);
        const oldValueBuffer = Buffer.from(oldValue, 'utf8');
        const newValueBuffer = Buffer.from(valueStr, 'utf8');
        
        // 构建新的数据库内容
        const before = buffer.slice(0, oldValueIndex);
        const after = buffer.slice(oldValueIndex + oldValueBuffer.length);
        
        // 如果新值比旧值长，需要调整
        let newBuffer;
        if (newValueBuffer.length <= oldValueBuffer.length) {
          // 新值更短或相等，直接替换并填充空格
          const padding = Buffer.alloc(oldValueBuffer.length - newValueBuffer.length, 0x20);
          newBuffer = Buffer.concat([before, newValueBuffer, padding, after]);
        } else {
          // 新值更长，直接拼接（可能会增加文件大小）
          newBuffer = Buffer.concat([before, newValueBuffer, after]);
        }
        
        await fs.writeFile(dbPath, newBuffer);
        console.log(`已更新数据: ${key}`);
        return true;
      }
      
      console.warn('未找到旧值，使用追加模式');
      const newEntry = Buffer.from(`\n${valueStr}\n`, 'utf8');
      const newBuffer = Buffer.concat([buffer, newEntry]);
      await fs.writeFile(dbPath, newBuffer);
      return true;
      
    } catch (error) {
      console.error('更新数据库失败:', error);
      throw error;
    }
  }
}

module.exports = SQLiteHelper;

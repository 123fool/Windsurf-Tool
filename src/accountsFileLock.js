// accountsFileLock.js - 账号文件锁机制
// 防止并发写入导致数据丢失

class AccountsFileLock {
  constructor() {
    this.queue = [];
    this.isLocked = false;
  }

  /**
   * 获取锁并执行操作
   * @param {Function} operation - 要执行的异步操作
   * @returns {Promise} 操作结果
   */
  async acquire(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * 处理队列
   */
  async processQueue() {
    if (this.isLocked || this.queue.length === 0) {
      return;
    }

    this.isLocked = true;
    const { operation, resolve, reject } = this.queue.shift();

    try {
      const result = await operation();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.isLocked = false;
      // 处理下一个
      if (this.queue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  /**
   * 获取队列长度
   */
  getQueueLength() {
    return this.queue.length;
  }

  /**
   * 检查是否被锁定
   */
  isFileLocked() {
    return this.isLocked;
  }
}

// 单例模式
const accountsFileLock = new AccountsFileLock();

module.exports = accountsFileLock;

const Database = require('better-sqlite3');
const path = require('path');

// Initialize database
const dbPath = path.join(__dirname, 'database.db');
const db = new Database(dbPath);

console.log('📁 Database path:', dbPath);

// ========================
// Generate Random IDs
// ========================
function generateProductId() {
    return 'PROD-' + Math.floor(1000 + Math.random() * 9000);
}

function generateOrderId() {
    return 'ORD-' + Math.floor(1000 + Math.random() * 9000);
}

function generateKeyId() {
    return 'KEY-' + Math.floor(1000 + Math.random() * 9000);
}

// ========================
// Create Tables
// ========================
db.exec(`
    -- Server configs table (per-guild settings)
    CREATE TABLE IF NOT EXISTS server_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT UNIQUE NOT NULL,
        ltc_address TEXT,
        ltc_qr_url TEXT,
        vouch_channel_id TEXT,
        log_channel_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER
    );

    -- Server admins table
    CREATE TABLE IF NOT EXISTS server_admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        added_by TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(guild_id, user_id)
    );

    -- Products table (with guild_id for multi-server support)
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT UNIQUE NOT NULL,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        ltc_price REAL NOT NULL,
        stock INTEGER DEFAULT 0,
        image_url TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Orders table (with random order_id)
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT UNIQUE NOT NULL,
        guild_id TEXT,
        user_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        ltc_address TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        payment_method TEXT DEFAULT 'ltc',
        payment_code TEXT,
        txid TEXT,
        delivered_key TEXT,
        delivered_at INTEGER,
        refunded_at INTEGER,
        refunded_by TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER
    );

    -- Transactions table
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        txid TEXT NOT NULL,
        amount REAL NOT NULL,
        confirmations INTEGER DEFAULT 0,
        timestamp INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Product keys/codes table
    CREATE TABLE IF NOT EXISTS product_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id TEXT UNIQUE NOT NULL,
        product_id TEXT NOT NULL,
        key_value TEXT NOT NULL,
        is_used INTEGER DEFAULT 0,
        used_by TEXT,
        used_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Payment methods table (per-guild)
    CREATE TABLE IF NOT EXISTS payment_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'giftcard',
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(guild_id, name)
    );
`);

console.log('✅ Database tables initialized');

// ========================
// Helper Functions
// ========================

// Server Configs
db.getServerConfig = (guildId) => {
    return db.prepare('SELECT * FROM server_configs WHERE guild_id = ?').get(guildId);
};

db.upsertServerConfig = (guildId, config) => {
    const existing = db.getServerConfig(guildId);
    if (existing) {
        const updates = [];
        const values = [];
        if (config.ltc_address !== undefined) { updates.push('ltc_address = ?'); values.push(config.ltc_address); }
        if (config.ltc_qr_url !== undefined) { updates.push('ltc_qr_url = ?'); values.push(config.ltc_qr_url); }
        if (config.vouch_channel_id !== undefined) { updates.push('vouch_channel_id = ?'); values.push(config.vouch_channel_id); }
        if (config.log_channel_id !== undefined) { updates.push('log_channel_id = ?'); values.push(config.log_channel_id); }
        if (updates.length > 0) {
            updates.push('updated_at = strftime(\'%s\', \'now\')');
            values.push(guildId);
            db.prepare(`UPDATE server_configs SET ${updates.join(', ')} WHERE guild_id = ?`).run(...values);
        }
    } else {
        db.prepare(`
            INSERT INTO server_configs (guild_id, ltc_address, ltc_qr_url, vouch_channel_id, log_channel_id) 
            VALUES (?, ?, ?, ?, ?)
        `).run(guildId, config.ltc_address || null, config.ltc_qr_url || null, config.vouch_channel_id || null, config.log_channel_id || null);
    }
    return db.getServerConfig(guildId);
};

// Server Admins
db.getServerAdmins = (guildId) => {
    return db.prepare('SELECT * FROM server_admins WHERE guild_id = ?').all(guildId);
};

db.isServerAdmin = (guildId, userId) => {
    const admin = db.prepare('SELECT * FROM server_admins WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    return !!admin;
};

db.addServerAdmin = (guildId, userId, addedBy) => {
    try {
        db.prepare('INSERT INTO server_admins (guild_id, user_id, added_by) VALUES (?, ?, ?)').run(guildId, userId, addedBy);
        return true;
    } catch (e) {
        return false; // Already exists
    }
};

db.removeServerAdmin = (guildId, userId) => {
    return db.prepare('DELETE FROM server_admins WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
};

// Products (with guild support)
db.getProducts = (guildId = null) => {
    if (guildId) {
        return db.prepare('SELECT * FROM products WHERE guild_id = ? ORDER BY id DESC').all(guildId);
    }
    return db.prepare('SELECT * FROM products ORDER BY id DESC').all();
};

db.getProductById = (productId, guildId = null) => {
    if (typeof productId === 'string' && productId.startsWith('PROD-')) {
        if (guildId) {
            return db.prepare('SELECT * FROM products WHERE product_id = ? AND guild_id = ?').get(productId, guildId);
        }
        return db.prepare('SELECT * FROM products WHERE product_id = ?').get(productId);
    }
    if (guildId) {
        return db.prepare('SELECT * FROM products WHERE (id = ? OR product_id = ?) AND guild_id = ?').get(productId, productId, guildId);
    }
    return db.prepare('SELECT * FROM products WHERE id = ? OR product_id = ?').get(productId, productId);
};

db.getProductByProductId = (productId) => {
    return db.prepare('SELECT * FROM products WHERE product_id = ?').get(productId);
};

db.addProduct = (name, description, ltcPrice, stock = 0, imageUrl = null, guildId = 'global') => {
    let productId = generateProductId();
    let attempts = 0;
    while (db.getProductByProductId(productId) && attempts < 10) {
        productId = generateProductId();
        attempts++;
    }
    
    const stmt = db.prepare('INSERT INTO products (product_id, guild_id, name, description, ltc_price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(productId, guildId, name, description, ltcPrice, stock, imageUrl);
    console.log(`📦 New product created: ${name} (ID: ${productId}) for guild ${guildId}`);
    return { ...result, productId };
};

db.updateProductStock = (productId, newStock) => {
    if (typeof productId === 'string' && productId.startsWith('PROD-')) {
        return db.prepare('UPDATE products SET stock = ? WHERE product_id = ?').run(newStock, productId);
    }
    return db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(newStock, productId);
};

db.deleteProduct = (productId) => {
    if (typeof productId === 'string' && productId.startsWith('PROD-')) {
        // Also delete associated keys
        db.prepare('DELETE FROM product_keys WHERE product_id = ?').run(productId);
        return db.prepare('DELETE FROM products WHERE product_id = ?').run(productId);
    }
    const product = db.prepare('SELECT product_id FROM products WHERE id = ?').get(productId);
    if (product) {
        db.prepare('DELETE FROM product_keys WHERE product_id = ?').run(product.product_id);
    }
    return db.prepare('DELETE FROM products WHERE id = ?').run(productId);
};

// Orders
db.getOrders = () => {
    return db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
};

db.getOrderById = (orderId) => {
    // Support both numeric id and string order_id
    if (typeof orderId === 'string' && orderId.startsWith('ORD-')) {
        return db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
    }
    return db.prepare('SELECT * FROM orders WHERE id = ? OR order_id = ?').get(orderId, orderId);
};

db.getOrderByOrderId = (orderId) => {
    return db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
};

db.getPendingOrders = () => {
    return db.prepare("SELECT * FROM orders WHERE status = 'pending'").all();
};

db.getOrdersByUser = (userId) => {
    return db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(userId);
};

db.createOrder = (userId, productId, ltcAddress, amount, paymentMethod = 'ltc', paymentCode = null, guildId = null) => {
    let orderId = generateOrderId();
    let attempts = 0;
    while (db.getOrderByOrderId(orderId) && attempts < 10) {
        orderId = generateOrderId();
        attempts++;
    }
    
    const stmt = db.prepare(`
        INSERT INTO orders (order_id, guild_id, user_id, product_id, ltc_address, amount, status, payment_method, payment_code, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, strftime('%s', 'now'))
    `);
    const result = stmt.run(orderId, guildId, userId, productId, ltcAddress, amount, paymentMethod, paymentCode);
    console.log(`🛒 New order created: ${orderId} for user ${userId} in guild ${guildId}`);
    return { ...result, orderId };
};

db.updateOrderStatus = (orderId, status, txid = null) => {
    const orderIdField = (typeof orderId === 'string' && orderId.startsWith('ORD-')) ? 'order_id' : 'id';
    
    if (txid) {
        return db.prepare(`
            UPDATE orders 
            SET status = ?, txid = ?, updated_at = strftime('%s', 'now') 
            WHERE ${orderIdField} = ?
        `).run(status, txid, orderId);
    }
    return db.prepare(`
        UPDATE orders 
        SET status = ?, updated_at = strftime('%s', 'now') 
        WHERE ${orderIdField} = ?
    `).run(status, orderId);
};

db.markOrderPaid = (orderId, txid) => {
    return db.updateOrderStatus(orderId, 'paid', txid);
};

db.markOrderDelivered = (orderId, deliveredKey = null) => {
    const orderIdField = (typeof orderId === 'string' && orderId.startsWith('ORD-')) ? 'order_id' : 'id';
    return db.prepare(`
        UPDATE orders 
        SET status = 'delivered', delivered_key = ?, delivered_at = strftime('%s', 'now'), updated_at = strftime('%s', 'now') 
        WHERE ${orderIdField} = ?
    `).run(deliveredKey, orderId);
};

db.refundOrder = (orderId, refundedBy) => {
    const orderIdField = (typeof orderId === 'string' && orderId.startsWith('ORD-')) ? 'order_id' : 'id';
    return db.prepare(`
        UPDATE orders 
        SET status = 'refunded', refunded_at = strftime('%s', 'now'), refunded_by = ?, updated_at = strftime('%s', 'now') 
        WHERE ${orderIdField} = ?
    `).run(refundedBy, orderId);
};

// Transactions
db.addTransaction = (orderId, txid, amount, confirmations = 0) => {
    const stmt = db.prepare(`
        INSERT INTO transactions (order_id, txid, amount, confirmations, timestamp) 
        VALUES (?, ?, ?, ?, strftime('%s', 'now'))
    `);
    const result = stmt.run(orderId, txid, amount, confirmations);
    console.log(`💰 Transaction recorded: ${txid} for order ${orderId}`);
    return result;
};

db.updateTransactionConfirmations = (txid, confirmations) => {
    return db.prepare('UPDATE transactions SET confirmations = ? WHERE txid = ?').run(confirmations, txid);
};

db.getTransactionByTxid = (txid) => {
    return db.prepare('SELECT * FROM transactions WHERE txid = ?').get(txid);
};

// Product Keys
db.addProductKey = (productId, keyValue) => {
    const keyId = generateKeyId();
    return db.prepare('INSERT INTO product_keys (key_id, product_id, key_value) VALUES (?, ?, ?)').run(keyId, productId, keyValue);
};

db.getAvailableKey = (productId) => {
    return db.prepare('SELECT * FROM product_keys WHERE product_id = ? AND is_used = 0 LIMIT 1').get(productId);
};

db.markKeyUsed = (keyId, userId) => {
    // Support both numeric id and string key_id
    const keyIdField = (typeof keyId === 'string' && keyId.startsWith('KEY-')) ? 'key_id' : 'id';
    return db.prepare(`
        UPDATE product_keys 
        SET is_used = 1, used_by = ?, used_at = strftime('%s', 'now') 
        WHERE ${keyIdField} = ?
    `).run(userId, keyId);
};

db.returnKeyToStock = (keyValue) => {
    return db.prepare(`
        UPDATE product_keys 
        SET is_used = 0, used_by = NULL, used_at = NULL 
        WHERE key_value = ?
    `).run(keyValue);
};

db.getProductKeyCount = (productId) => {
    const result = db.prepare('SELECT COUNT(*) as count FROM product_keys WHERE product_id = ? AND is_used = 0').get(productId);
    return result ? result.count : 0;
};

// Payment Methods (with guild support)
db.addPaymentMethod = (name, description = null, type = 'giftcard', guildId = 'global') => {
    const stmt = db.prepare('INSERT INTO payment_methods (guild_id, name, description, type) VALUES (?, ?, ?, ?)');
    const result = stmt.run(guildId, name, description, type);
    console.log(`💳 New payment method added: ${name} (${type}) for guild ${guildId}`);
    return result;
};

db.getPaymentMethods = (guildId = null) => {
    if (guildId) {
        return db.prepare('SELECT * FROM payment_methods WHERE (guild_id = ? OR guild_id = \'global\') AND is_active = 1 ORDER BY id ASC').all(guildId);
    }
    return db.prepare('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY id ASC').all();
};

db.getPaymentMethodByName = (name, guildId = null) => {
    if (guildId) {
        return db.prepare('SELECT * FROM payment_methods WHERE name = ? AND (guild_id = ? OR guild_id = \'global\')').get(name, guildId);
    }
    return db.prepare('SELECT * FROM payment_methods WHERE name = ?').get(name);
};

db.deletePaymentMethod = (name, guildId = null) => {
    if (guildId) {
        return db.prepare('DELETE FROM payment_methods WHERE name = ? AND guild_id = ?').run(name, guildId);
    }
    return db.prepare('DELETE FROM payment_methods WHERE name = ?').run(name);
};

db.togglePaymentMethod = (name, isActive, guildId = null) => {
    if (guildId) {
        return db.prepare('UPDATE payment_methods SET is_active = ? WHERE name = ? AND guild_id = ?').run(isActive ? 1 : 0, name, guildId);
    }
    return db.prepare('UPDATE payment_methods SET is_active = ? WHERE name = ?').run(isActive ? 1 : 0, name);
};

// Export generators for use in other files
db.generateProductId = generateProductId;
db.generateOrderId = generateOrderId;
db.generateKeyId = generateKeyId;

module.exports = db;

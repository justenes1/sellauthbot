const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ========================
// Configuration (Hardcoded)
// ========================
const CLIENT_ID = '1447366056904491079';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const LTC_ADDRESS = 'Lendcpxh1hrmCePoKiNx8otRksC1TG8T8H';
const LTC_QR_CODE_URL = 'https://cdn.discordapp.com/attachments/1444350061298323486/1447379141795123251/Screenshot_20241207-1859392.png';
const BOT_OWNER_ID = '1425207525166551261';
const BLOCKCYPHER_API_KEY = 'bf863a82813746c2ae97fcca1ba7f4a7';

const CONFIRMATION_THRESHOLDS = {
    small: { maxAmount: 0.1, confirmations: 1 },
    medium: { maxAmount: 1, confirmations: 3 },
    large: { maxAmount: 10, confirmations: 6 },
    xlarge: { confirmations: 10 }
};

console.log("📦 Config loaded:", { 
    CLIENT_ID: "✓ Set",
    DISCORD_TOKEN: DISCORD_TOKEN ? "✓ Set" : "✗ Missing",
    LTC_ADDRESS: "✓ Set",
    BOT_OWNER_ID: "✓ Set"
});

if (!DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN missing! Add it to your .env file.");
    process.exit(1);
}

// ========================
// Auto-Generate Commands Folder
// ========================
const commandsPath = path.join(__dirname, 'commands');
const servicesPath = path.join(__dirname, 'services');

function createCommandsFolder() {
    console.log('📁 Creating commands folder and files...');
    
    if (!fs.existsSync(commandsPath)) {
        fs.mkdirSync(commandsPath, { recursive: true });
    }
    if (!fs.existsSync(servicesPath)) {
        fs.mkdirSync(servicesPath, { recursive: true });
    }

    // Products command
    const productsCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('products')
        .setDescription('View all available products'),

    async execute(interaction, client) {
        const products = db.getProducts();
        
        if (products.length === 0) {
            return interaction.reply({ content: '📦 No products available yet.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🛒 Available Products')
            .setColor(0x00AAFF)
            .setTimestamp();

        for (const product of products) {
            embed.addFields({
                name: \`#\${product.id} - \${product.name}\`,
                value: \`💰 \${product.ltc_price} LTC | 📦 Stock: \${product.stock}\\n\${product.description || 'No description'}\`,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed] });
    }
};`;

    // Buy command
    const buyCmd = `const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Purchase a product')
        .addIntegerOption(option =>
            option.setName('product_id')
                .setDescription('The ID of the product to buy')
                .setRequired(true)
        ),

    async execute(interaction, client) {
        const productId = interaction.options.getInteger('product_id');
        const product = db.getProductById(productId);

        if (!product) {
            return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        if (product.stock <= 0) {
            return interaction.reply({ content: '❌ This product is out of stock.', ephemeral: true });
        }

        // Create order
        const result = db.createOrder(interaction.user.id, productId, client.config.LTC_ADDRESS, product.ltc_price);
        const orderId = result.lastInsertRowid;

        // Add to pending orders
        client.pendingOrders.set(orderId, {
            orderId,
            userId: interaction.user.id,
            productId,
            ltcAddress: client.config.LTC_ADDRESS,
            amount: product.ltc_price,
            createdAt: Date.now()
        });

        const embed = new EmbedBuilder()
            .setTitle('🛒 Order Created!')
            .setColor(0x00FF00)
            .setDescription(\`Send exactly **\${product.ltc_price} LTC** to complete your purchase.\`)
            .addFields(
                { name: '📦 Product', value: product.name, inline: true },
                { name: '💰 Price', value: \`\${product.ltc_price} LTC\`, inline: true },
                { name: '🔢 Order ID', value: \`#\${orderId}\`, inline: true },
                { name: '📬 Send LTC to:', value: \`\\\`\${client.config.LTC_ADDRESS}\\\`\` }
            )
            .setImage(client.config.LTC_QR_CODE_URL)
            .setFooter({ text: 'Payment will be detected automatically' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Orders command
    const ordersCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('orders')
        .setDescription('View your order history'),

    async execute(interaction, client) {
        const orders = db.getOrdersByUser(interaction.user.id);

        if (orders.length === 0) {
            return interaction.reply({ content: '📋 You have no orders yet.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('📋 Your Orders')
            .setColor(0x00AAFF)
            .setTimestamp();

        for (const order of orders.slice(0, 10)) {
            const product = db.getProductById(order.product_id);
            const status = order.status === 'paid' ? '✅' : order.status === 'delivered' ? '📦' : '⏳';
            embed.addFields({
                name: \`\${status} Order #\${order.id}\`,
                value: \`Product: \${product ? product.name : 'Unknown'} | \${order.amount} LTC | Status: \${order.status}\`,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Add Product command
    const addProductCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addproduct')
        .setDescription('Add a new product (Owner only)')
        .addStringOption(option => option.setName('name').setDescription('Product name').setRequired(true))
        .addNumberOption(option => option.setName('price').setDescription('Price in LTC').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('Product description').setRequired(false))
        .addIntegerOption(option => option.setName('stock').setDescription('Initial stock').setRequired(false)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can add products.', ephemeral: true });
        }

        const name = interaction.options.getString('name');
        const price = interaction.options.getNumber('price');
        const description = interaction.options.getString('description') || '';
        const stock = interaction.options.getInteger('stock') || 0;

        const result = db.addProduct(name, description, price, stock);

        const embed = new EmbedBuilder()
            .setTitle('✅ Product Added')
            .setColor(0x00FF00)
            .addFields(
                { name: 'ID', value: \`#\${result.lastInsertRowid}\`, inline: true },
                { name: 'Name', value: name, inline: true },
                { name: 'Price', value: \`\${price} LTC\`, inline: true },
                { name: 'Stock', value: \`\${stock}\`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Edit Product command
    const editProductCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('editproduct')
        .setDescription('Edit an existing product (Owner only)')
        .addIntegerOption(option => option.setName('product_id').setDescription('Product ID').setRequired(true))
        .addStringOption(option => option.setName('name').setDescription('New name').setRequired(false))
        .addNumberOption(option => option.setName('price').setDescription('New price').setRequired(false))
        .addIntegerOption(option => option.setName('stock').setDescription('New stock').setRequired(false))
        .addStringOption(option => option.setName('description').setDescription('New description').setRequired(false)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can edit products.', ephemeral: true });
        }

        const productId = interaction.options.getInteger('product_id');
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
        
        if (!product) {
            return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        const updates = [];
        const values = [];

        const name = interaction.options.getString('name');
        const price = interaction.options.getNumber('price');
        const stock = interaction.options.getInteger('stock');
        const desc = interaction.options.getString('description');

        if (name) { updates.push('name = ?'); values.push(name); }
        if (price !== null) { updates.push('ltc_price = ?'); values.push(price); }
        if (stock !== null) { updates.push('stock = ?'); values.push(stock); }
        if (desc) { updates.push('description = ?'); values.push(desc); }

        if (updates.length === 0) {
            return interaction.reply({ content: '❌ Provide at least one field to update.', ephemeral: true });
        }

        values.push(productId);
        db.prepare(\`UPDATE products SET \${updates.join(', ')} WHERE id = ?\`).run(...values);

        const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);

        const embed = new EmbedBuilder()
            .setTitle('✏️ Product Updated')
            .setColor(0xFFAA00)
            .addFields(
                { name: 'ID', value: \`#\${productId}\`, inline: true },
                { name: 'Name', value: updated.name, inline: true },
                { name: 'Price', value: \`\${updated.ltc_price} LTC\`, inline: true },
                { name: 'Stock', value: \`\${updated.stock}\`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Delete Product command
    const deleteProductCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deleteproduct')
        .setDescription('Delete a product (Owner only)')
        .addIntegerOption(option => option.setName('product_id').setDescription('Product ID').setRequired(true)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can delete products.', ephemeral: true });
        }

        const productId = interaction.options.getInteger('product_id');
        const product = db.getProductById(productId);

        if (!product) {
            return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        db.deleteProduct(productId);

        const embed = new EmbedBuilder()
            .setTitle('🗑️ Product Deleted')
            .setColor(0xFF0000)
            .setDescription(\`Product **\${product.name}** has been deleted.\`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Add Key command
    const addKeyCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addkey')
        .setDescription('Add a product key (Owner only)')
        .addIntegerOption(option => option.setName('product_id').setDescription('Product ID').setRequired(true))
        .addStringOption(option => option.setName('key').setDescription('The key/code to add').setRequired(true)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can add keys.', ephemeral: true });
        }

        const productId = interaction.options.getInteger('product_id');
        const key = interaction.options.getString('key');

        const product = db.getProductById(productId);
        if (!product) {
            return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        db.addProductKey(productId, key);
        const newCount = db.getProductKeyCount(productId);
        db.updateProductStock(productId, newCount);

        const embed = new EmbedBuilder()
            .setTitle('🔑 Key Added')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Product', value: product.name, inline: true },
                { name: 'New Stock', value: \`\${newCount}\`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Stock command
    const stockCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stock')
        .setDescription('View product stock (Owner only)'),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can view stock.', ephemeral: true });
        }

        const products = db.getProducts();

        if (products.length === 0) {
            return interaction.reply({ content: '📦 No products yet.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Stock Overview')
            .setColor(0x00AAFF)
            .setTimestamp();

        for (const product of products) {
            const keyCount = db.getProductKeyCount(product.id);
            embed.addFields({
                name: \`#\${product.id} - \${product.name}\`,
                value: \`Stock: \${product.stock} | Keys: \${keyCount}\`,
                inline: true
            });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Payment Checker service
    const paymentCheckerSvc = `const axios = require('axios');
const db = require('../database');

const CHECK_INTERVAL = 25000;
const MIN_CONFIRMATIONS = 1;

module.exports = {
    start(client) {
        console.log('🔄 Payment checker started (25s interval)');
        this.checkPayments(client);
        setInterval(() => this.checkPayments(client), CHECK_INTERVAL);
    },

    async checkPayments(client) {
        try {
            const pending = db.prepare("SELECT * FROM orders WHERE status = 'pending'").all();
            if (pending.length === 0) return;

            console.log(\`🔍 Checking \${pending.length} pending order(s)...\`);
            for (const order of pending) {
                await this.checkOrder(order, client);
            }
        } catch (e) {
            console.error('❌ Payment check error:', e.message);
        }
    },

    async checkOrder(order, client) {
        try {
            const url = \`https://sochain.com/api/v2/get_tx_received/LTC/\${order.ltc_address}\`;
            const res = await axios.get(url, { timeout: 10000 });
            
            if (!res.data?.data?.txs) return;

            for (const tx of res.data.data.txs) {
                if (parseFloat(tx.value) >= order.amount && tx.confirmations >= MIN_CONFIRMATIONS) {
                    await this.processPayment(order, tx, client);
                }
            }
        } catch (e) {
            console.error(\`❌ Order #\${order.id} check failed:\`, e.message);
        }
    },

    async processPayment(order, tx, client) {
        console.log(\`✅ Payment confirmed for order #\${order.id}\`);
        
        db.prepare("UPDATE orders SET status = 'paid', txid = ? WHERE id = ?").run(tx.txid, order.id);
        db.addTransaction(order.id, tx.txid, parseFloat(tx.value), tx.confirmations);
        client.pendingOrders.delete(order.id);

        const product = db.getProductById(order.product_id);
        
        try {
            const user = await client.users.fetch(order.user_id);
            await user.send({
                embeds: [{
                    color: 0x00FF00,
                    title: '✅ Payment Confirmed!',
                    description: \`Your payment for **\${product?.name || 'your order'}** was received!\`,
                    fields: [
                        { name: 'Order ID', value: \`#\${order.id}\`, inline: true },
                        { name: 'Amount', value: \`\${order.amount} LTC\`, inline: true },
                        { name: 'TXID', value: \`\\\`\${tx.txid}\\\`\` }
                    ]
                }]
            });

            // Deliver product key
            const key = db.getAvailableKey(order.product_id);
            if (key) {
                db.markKeyUsed(key.id, order.user_id);
                db.updateProductStock(order.product_id, db.getProductKeyCount(order.product_id));
                db.markOrderDelivered(order.id);
                
                await user.send({
                    embeds: [{
                        color: 0x00AAFF,
                        title: '📦 Product Delivered!',
                        fields: [{ name: '🔑 Your Key', value: \`\\\`\\\`\\\`\${key.key_value}\\\`\\\`\\\`\` }]
                    }]
                });
            }
        } catch (e) {
            console.error('❌ Could not notify user:', e.message);
        }
    }
};`;

    // Write all files
    fs.writeFileSync(path.join(commandsPath, 'products.js'), productsCmd);
    fs.writeFileSync(path.join(commandsPath, 'buy.js'), buyCmd);
    fs.writeFileSync(path.join(commandsPath, 'orders.js'), ordersCmd);
    fs.writeFileSync(path.join(commandsPath, 'addproduct.js'), addProductCmd);
    fs.writeFileSync(path.join(commandsPath, 'editproduct.js'), editProductCmd);
    fs.writeFileSync(path.join(commandsPath, 'deleteproduct.js'), deleteProductCmd);
    fs.writeFileSync(path.join(commandsPath, 'addkey.js'), addKeyCmd);
    fs.writeFileSync(path.join(commandsPath, 'stock.js'), stockCmd);
    fs.writeFileSync(path.join(servicesPath, 'paymentChecker.js'), paymentCheckerSvc);

    console.log('✅ Created 8 command files + payment checker');
}

// Check if commands folder exists, if not create it
const commandFiles = fs.existsSync(commandsPath) ? fs.readdirSync(commandsPath).filter(f => f.endsWith('.js')) : [];
if (commandFiles.length === 0) {
    createCommandsFolder();
}

// ========================
// Initialize Database
// ========================
const db = require('./database');

// ========================
// Discord Client Setup
// ========================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.config = {
    CLIENT_ID,
    DISCORD_TOKEN,
    LTC_ADDRESS,
    LTC_QR_CODE_URL,
    BOT_OWNER_ID,
    BLOCKCYPHER_API_KEY,
    CONFIRMATION_THRESHOLDS
};

client.commands = new Collection();
client.pendingProducts = new Map();
client.pendingOrders = new Map();

// ========================
// Load Commands
// ========================
const loadedCommands = [];
const cmdFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of cmdFiles) {
    const command = require(path.join(commandsPath, file));
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        loadedCommands.push(command.data.toJSON());
        console.log(`📌 Loaded: /${command.data.name}`);
    }
}

// ========================
// Register Slash Commands
// ========================
async function registerCommands() {
    if (loadedCommands.length === 0) {
        console.log("⚠️ No commands to register.");
        return;
    }

    const rest = new REST().setToken(DISCORD_TOKEN);
    try {
        console.log('🔄 Registering slash commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: loadedCommands });
        console.log(`✅ Registered ${loadedCommands.length} slash commands!`);
    } catch (error) {
        console.error('❌ Failed to register commands:', error);
    }
}

// ========================
// Handle Interactions
// ========================
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`❌ Error in /${interaction.commandName}:`, error);
            const reply = { content: '❌ Command error!', ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }
    }
});

// ========================
// Bot Ready
// ========================
client.once('ready', async () => {
    console.log(`\n========================================`);
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
    console.log(`========================================\n`);

    await registerCommands();

    // Start payment checker
    const paymentChecker = require('./services/paymentChecker');
    paymentChecker.start(client);

    // Load pending orders
    const pending = db.prepare("SELECT * FROM orders WHERE status = 'pending'").all();
    for (const order of pending) {
        client.pendingOrders.set(order.id, order);
    }
    console.log(`📋 Loaded ${pending.length} pending orders`);
});

// ========================
// Error Handling
// ========================
client.on('error', e => console.error('❌ Client error:', e));
process.on('unhandledRejection', e => console.error('❌ Unhandled rejection:', e));

// ========================
// Start Bot
// ========================
client.login(DISCORD_TOKEN);

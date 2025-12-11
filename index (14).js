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
const VOUCH_CHANNEL_ID = 'YOUR_VOUCH_CHANNEL_ID'; // Replace with your vouches channel ID

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

    // Products command (guild-specific)
    const productsCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('products')
        .setDescription('View all available products'),

    async execute(interaction, client) {
        const guildId = interaction.guild?.id;
        const products = db.getProducts(guildId);
        
        if (products.length === 0) {
            return interaction.reply({ content: '📦 No products available yet.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🛒 Available Products')
            .setColor(0x00AAFF)
            .setTimestamp();

        for (const product of products) {
            embed.addFields({
                name: \`\${product.product_id} - \${product.name}\`,
                value: \`💰 \${product.ltc_price} LTC | 📦 Stock: \${product.stock}\\n\${product.description || 'No description'}\`,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed] });
    }
};`;

    // Buy command (with random order ID, guild-specific)
    const buyCmd = `const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Purchase a product')
        .addStringOption(option =>
            option.setName('product_id')
                .setDescription('The Product ID (e.g., PROD-1234)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('payment_method')
                .setDescription('Payment method (default: ltc)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('payment_code')
                .setDescription('Gift card code (if using gift card payment)')
                .setRequired(false)
        ),

    async execute(interaction, client) {
        const guildId = interaction.guild?.id;
        const productId = interaction.options.getString('product_id').toUpperCase();
        const paymentMethod = interaction.options.getString('payment_method') || 'ltc';
        const paymentCode = interaction.options.getString('payment_code');
        
        // Get guild-specific config
        const serverConfig = guildId ? db.getServerConfig(guildId) : null;
        const ltcAddress = serverConfig?.ltc_address || client.config.LTC_ADDRESS;
        const ltcQrUrl = serverConfig?.ltc_qr_url || client.config.LTC_QR_CODE_URL;
        
        const product = db.getProductById(productId, guildId);

        if (!product) {
            return interaction.reply({ content: '❌ Product not found. Use /products to see available products.', ephemeral: true });
        }

        if (product.stock <= 0) {
            return interaction.reply({ content: '❌ This product is out of stock.', ephemeral: true });
        }

        // Check payment method if not LTC
        if (paymentMethod.toLowerCase() !== 'ltc') {
            const pm = db.getPaymentMethodByName(paymentMethod, guildId);
            if (!pm) {
                return interaction.reply({ content: \`❌ Payment method "\${paymentMethod}" not found. Use /paymentmethods to see available options.\`, ephemeral: true });
            }
            if (!paymentCode) {
                return interaction.reply({ content: '❌ Payment code required for this payment method.', ephemeral: true });
            }
        }

        // Create order with random ID
        const result = db.createOrder(
            interaction.user.id, 
            product.product_id, 
            ltcAddress, 
            product.ltc_price,
            paymentMethod.toLowerCase(),
            paymentCode,
            guildId
        );
        const orderId = result.orderId;

        // Add to pending orders
        client.pendingOrders.set(orderId, {
            orderId,
            orderIdStr: orderId,
            userId: interaction.user.id,
            productId: product.product_id,
            ltcAddress: ltcAddress,
            amount: product.ltc_price,
            paymentMethod: paymentMethod.toLowerCase(),
            paymentCode,
            guildId,
            createdAt: Date.now()
        });

        // If gift card payment, notify owner
        if (paymentMethod.toLowerCase() !== 'ltc' && paymentCode) {
            try {
                const owner = await client.users.fetch(client.config.BOT_OWNER_ID);
                const notifyEmbed = new EmbedBuilder()
                    .setTitle('🎁 New Gift Card Payment')
                    .setColor(0xFFAA00)
                    .addFields(
                        { name: '👤 User', value: \`\${interaction.user.tag} (\${interaction.user.id})\`, inline: true },
                        { name: '🔢 Order ID', value: orderId, inline: true },
                        { name: '📦 Product', value: product.name, inline: true },
                        { name: '💰 Amount', value: \`\${product.ltc_price} LTC\`, inline: true },
                        { name: '💳 Payment Method', value: paymentMethod, inline: true },
                        { name: '🏠 Server', value: interaction.guild?.name || 'DM', inline: true },
                        { name: '🔑 Code', value: \`\\\`\${paymentCode}\\\`\` }
                    )
                    .setFooter({ text: 'Use /confirmorder to confirm payment' })
                    .setTimestamp();
                
                await owner.send({ embeds: [notifyEmbed] });
            } catch (e) {
                console.error('❌ Could not notify owner:', e.message);
            }

            const embed = new EmbedBuilder()
                .setTitle('🛒 Order Created!')
                .setColor(0xFFAA00)
                .setDescription('Your gift card code has been submitted for review.')
                .addFields(
                    { name: '📦 Product', value: product.name, inline: true },
                    { name: '💰 Price', value: \`\${product.ltc_price} LTC\`, inline: true },
                    { name: '🔢 Order ID', value: orderId, inline: true },
                    { name: '💳 Payment Method', value: paymentMethod, inline: true },
                    { name: '⏳ Status', value: 'Awaiting confirmation' }
                )
                .setFooter({ text: 'You will be notified when payment is confirmed' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // LTC payment
        const embed = new EmbedBuilder()
            .setTitle('🛒 Order Created!')
            .setColor(0x00FF00)
            .setDescription(\`Send exactly **\${product.ltc_price} LTC** to complete your purchase.\`)
            .addFields(
                { name: '📦 Product', value: product.name, inline: true },
                { name: '💰 Price', value: \`\${product.ltc_price} LTC\`, inline: true },
                { name: '🔢 Order ID', value: orderId, inline: true },
                { name: '📬 Send LTC to:', value: \`\\\`\${ltcAddress}\\\`\` }
            )
            .setImage(ltcQrUrl)
            .setFooter({ text: 'Payment will be detected automatically • Order expires in 30 minutes' })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(\`check_\${orderId}\`)
                    .setLabel('Check Status')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(\`cancel_\${orderId}\`)
                    .setLabel('Cancel Order')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
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
            const statusEmoji = {
                'pending': '⏳',
                'paid': '✅',
                'delivered': '📦',
                'refunded': '💸',
                'cancelled': '❌'
            }[order.status] || '❓';
            
            embed.addFields({
                name: \`\${statusEmoji} \${order.order_id}\`,
                value: \`Product: \${product ? product.name : 'Unknown'} | \${order.amount} LTC | Status: \${order.status}\`,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Add Product command (with random product ID, guild-specific)
    const addProductCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addproduct')
        .setDescription('Add a new product (Owner/Admin only)')
        .addStringOption(option => option.setName('name').setDescription('Product name').setRequired(true))
        .addNumberOption(option => option.setName('price').setDescription('Price in LTC').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('Product description').setRequired(false))
        .addIntegerOption(option => option.setName('stock').setDescription('Initial stock').setRequired(false))
        .addStringOption(option => option.setName('image_url').setDescription('Product image URL').setRequired(false)),

    async execute(interaction, client) {
        const guildId = interaction.guild?.id;
        const isOwner = interaction.user.id === client.config.BOT_OWNER_ID;
        const isAdmin = guildId ? db.isServerAdmin(guildId, interaction.user.id) : false;

        if (!isOwner && !isAdmin) {
            return interaction.reply({ content: '❌ Only the bot owner or server admins can add products.', ephemeral: true });
        }

        const name = interaction.options.getString('name');
        const price = interaction.options.getNumber('price');
        const description = interaction.options.getString('description') || '';
        const stock = interaction.options.getInteger('stock') || 0;
        const imageUrl = interaction.options.getString('image_url') || null;

        const result = db.addProduct(name, description, price, stock, imageUrl, guildId || 'global');

        const embed = new EmbedBuilder()
            .setTitle('✅ Product Added')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Product ID', value: result.productId, inline: true },
                { name: 'Name', value: name, inline: true },
                { name: 'Price', value: \`\${price} LTC\`, inline: true },
                { name: 'Stock', value: \`\${stock}\`, inline: true },
                { name: 'Server', value: interaction.guild?.name || 'Global', inline: true }
            )
            .setTimestamp();

        if (imageUrl) {
            embed.setThumbnail(imageUrl);
        }

        console.log(\`📦 Product added: \${result.productId} - \${name} for guild \${guildId}\`);
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
        .addStringOption(option => option.setName('product_id').setDescription('Product ID (e.g., PROD-1234)').setRequired(true))
        .addStringOption(option => option.setName('name').setDescription('New name').setRequired(false))
        .addNumberOption(option => option.setName('price').setDescription('New price').setRequired(false))
        .addIntegerOption(option => option.setName('stock').setDescription('New stock').setRequired(false))
        .addStringOption(option => option.setName('description').setDescription('New description').setRequired(false))
        .addStringOption(option => option.setName('image_url').setDescription('New image URL').setRequired(false)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can edit products.', ephemeral: true });
        }

        const productId = interaction.options.getString('product_id').toUpperCase();
        const product = db.getProductById(productId);
        
        if (!product) {
            return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        const updates = [];
        const values = [];

        const name = interaction.options.getString('name');
        const price = interaction.options.getNumber('price');
        const stock = interaction.options.getInteger('stock');
        const desc = interaction.options.getString('description');
        const imageUrl = interaction.options.getString('image_url');

        if (name) { updates.push('name = ?'); values.push(name); }
        if (price !== null) { updates.push('ltc_price = ?'); values.push(price); }
        if (stock !== null) { updates.push('stock = ?'); values.push(stock); }
        if (desc) { updates.push('description = ?'); values.push(desc); }
        if (imageUrl) { updates.push('image_url = ?'); values.push(imageUrl); }

        if (updates.length === 0) {
            return interaction.reply({ content: '❌ Provide at least one field to update.', ephemeral: true });
        }

        values.push(product.product_id);
        db.prepare(\`UPDATE products SET \${updates.join(', ')} WHERE product_id = ?\`).run(...values);

        const updated = db.getProductById(product.product_id);

        const embed = new EmbedBuilder()
            .setTitle('✏️ Product Updated')
            .setColor(0xFFAA00)
            .addFields(
                { name: 'Product ID', value: updated.product_id, inline: true },
                { name: 'Name', value: updated.name, inline: true },
                { name: 'Price', value: \`\${updated.ltc_price} LTC\`, inline: true },
                { name: 'Stock', value: \`\${updated.stock}\`, inline: true }
            )
            .setTimestamp();

        console.log(\`✏️ Product edited: \${updated.product_id}\`);
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
        .addStringOption(option => option.setName('product_id').setDescription('Product ID (e.g., PROD-1234)').setRequired(true)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can delete products.', ephemeral: true });
        }

        const productId = interaction.options.getString('product_id').toUpperCase();
        const product = db.getProductById(productId);

        if (!product) {
            return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        db.deleteProduct(product.product_id);

        const embed = new EmbedBuilder()
            .setTitle('🗑️ Product Deleted')
            .setColor(0xFF0000)
            .setDescription(\`Product **\${product.name}** (\${product.product_id}) has been deleted.\`)
            .setTimestamp();

        console.log(\`🗑️ Product deleted: \${product.product_id}\`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Add Key command
    const addKeyCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addkey')
        .setDescription('Add product keys (Owner only)')
        .addStringOption(option => option.setName('product_id').setDescription('Product ID (e.g., PROD-1234)').setRequired(true))
        .addStringOption(option => option.setName('keys').setDescription('Keys (comma-separated for multiple)').setRequired(true)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can add keys.', ephemeral: true });
        }

        const productId = interaction.options.getString('product_id').toUpperCase();
        const keysInput = interaction.options.getString('keys');

        const product = db.getProductById(productId);
        if (!product) {
            return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        const keys = keysInput.split(',').map(k => k.trim()).filter(k => k.length > 0);
        let added = 0;

        for (const key of keys) {
            db.addProductKey(product.product_id, key);
            added++;
        }

        const newCount = db.getProductKeyCount(product.product_id);
        db.updateProductStock(product.product_id, newCount);

        const embed = new EmbedBuilder()
            .setTitle('🔑 Keys Added')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Product', value: \`\${product.name} (\${product.product_id})\`, inline: true },
                { name: 'Keys Added', value: \`\${added}\`, inline: true },
                { name: 'New Stock', value: \`\${newCount}\`, inline: true }
            )
            .setTimestamp();

        console.log(\`🔑 Added \${added} keys to \${product.product_id}\`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Stock command (guild-specific)
    const stockCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stock')
        .setDescription('View product stock (Owner/Admin only)'),

    async execute(interaction, client) {
        const guildId = interaction.guild?.id;
        const isOwner = interaction.user.id === client.config.BOT_OWNER_ID;
        const isAdmin = guildId ? db.isServerAdmin(guildId, interaction.user.id) : false;

        if (!isOwner && !isAdmin) {
            return interaction.reply({ content: '❌ Only the bot owner or server admins can view stock.', ephemeral: true });
        }

        const products = db.getProducts(guildId);

        if (products.length === 0) {
            return interaction.reply({ content: '📦 No products yet for this server.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Stock Overview')
            .setDescription(\`Server: \${interaction.guild?.name || 'Global'}\`)
            .setColor(0x00AAFF)
            .setTimestamp();

        for (const product of products) {
            const keyCount = db.getProductKeyCount(product.product_id);
            embed.addFields({
                name: \`\${product.product_id} - \${product.name}\`,
                value: \`Stock: \${product.stock} | Keys Available: \${keyCount}\`,
                inline: true
            });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Order Info command
    const orderInfoCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('orderinfo')
        .setDescription('View details of a specific order')
        .addStringOption(option => option.setName('order_id').setDescription('Order ID (e.g., ORD-1234)').setRequired(true)),

    async execute(interaction, client) {
        const orderId = interaction.options.getString('order_id').toUpperCase();
        const order = db.getOrderById(orderId);

        if (!order) {
            return interaction.reply({ content: '❌ Order not found.', ephemeral: true });
        }

        // Check permissions: owner can see all, users can only see their own
        if (order.user_id !== interaction.user.id && interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ You can only view your own orders.', ephemeral: true });
        }

        const product = db.getProductById(order.product_id);
        const statusEmoji = {
            'pending': '⏳',
            'paid': '✅',
            'delivered': '📦',
            'refunded': '💸',
            'cancelled': '❌'
        }[order.status] || '❓';

        const embed = new EmbedBuilder()
            .setTitle(\`\${statusEmoji} Order \${order.order_id}\`)
            .setColor(order.status === 'delivered' ? 0x00FF00 : order.status === 'refunded' ? 0xFF0000 : 0xFFAA00)
            .addFields(
                { name: '📦 Product', value: product ? \`\${product.name} (\${product.product_id})\` : order.product_id, inline: true },
                { name: '💰 Amount', value: \`\${order.amount} LTC\`, inline: true },
                { name: '📊 Status', value: order.status.toUpperCase(), inline: true },
                { name: '💳 Payment Method', value: order.payment_method || 'ltc', inline: true }
            )
            .setTimestamp();

        // Add buyer info for owner
        if (interaction.user.id === client.config.BOT_OWNER_ID) {
            try {
                const buyer = await client.users.fetch(order.user_id);
                embed.addFields({ name: '👤 Buyer', value: \`\${buyer.tag} (\${order.user_id})\`, inline: true });
            } catch {
                embed.addFields({ name: '👤 Buyer ID', value: order.user_id, inline: true });
            }
        }

        if (order.txid) {
            embed.addFields({ name: '🔗 Transaction ID', value: \`\\\`\${order.txid}\\\`\` });
        }

        if (order.delivered_key && (order.user_id === interaction.user.id || interaction.user.id === client.config.BOT_OWNER_ID)) {
            embed.addFields({ name: '🔑 Delivered Key', value: \`\\\`\\\`\\\`\${order.delivered_key}\\\`\\\`\\\`\` });
        }

        if (order.created_at) {
            embed.addFields({ name: '📅 Created', value: \`<t:\${order.created_at}:F>\`, inline: true });
        }

        if (order.delivered_at) {
            embed.addFields({ name: '📦 Delivered', value: \`<t:\${order.delivered_at}:F>\`, inline: true });
        }

        if (order.refunded_at) {
            embed.addFields({ name: '💸 Refunded', value: \`<t:\${order.refunded_at}:F>\`, inline: true });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Refund command
    const refundCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('refund')
        .setDescription('Refund an order (Owner only)')
        .addStringOption(option => option.setName('order_id').setDescription('Order ID (e.g., ORD-1234)').setRequired(true)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can refund orders.', ephemeral: true });
        }

        const orderId = interaction.options.getString('order_id').toUpperCase();
        const order = db.getOrderById(orderId);

        if (!order) {
            return interaction.reply({ content: '❌ Order not found.', ephemeral: true });
        }

        if (order.status === 'refunded') {
            return interaction.reply({ content: '❌ This order has already been refunded.', ephemeral: true });
        }

        if (order.status === 'pending') {
            return interaction.reply({ content: '❌ Cannot refund a pending order. Cancel it instead.', ephemeral: true });
        }

        // Return key to stock if delivered
        if (order.delivered_key) {
            db.returnKeyToStock(order.delivered_key);
            const product = db.getProductById(order.product_id);
            if (product) {
                const newCount = db.getProductKeyCount(product.product_id);
                db.updateProductStock(product.product_id, newCount);
            }
        }

        db.refundOrder(order.order_id, interaction.user.id);

        // Notify buyer
        try {
            const buyer = await client.users.fetch(order.user_id);
            await buyer.send({
                embeds: [{
                    color: 0xFF0000,
                    title: '💸 Order Refunded',
                    description: \`Your order **\${order.order_id}** has been refunded.\`,
                    fields: [
                        { name: 'Amount', value: \`\${order.amount} LTC\`, inline: true }
                    ],
                    timestamp: new Date().toISOString()
                }]
            });
        } catch (e) {
            console.error('❌ Could not notify buyer:', e.message);
        }

        const embed = new EmbedBuilder()
            .setTitle('💸 Order Refunded')
            .setColor(0xFF0000)
            .addFields(
                { name: 'Order ID', value: order.order_id, inline: true },
                { name: 'Amount', value: \`\${order.amount} LTC\`, inline: true },
                { name: 'Key Returned', value: order.delivered_key ? 'Yes' : 'No', inline: true }
            )
            .setTimestamp();

        console.log(\`💸 Order refunded: \${order.order_id}\`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Add Stock command
    const addStockCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addstock')
        .setDescription('Add stock to a product (Owner only)')
        .addStringOption(option => option.setName('product_id').setDescription('Product ID (e.g., PROD-1234)').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Amount to add').setRequired(true)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can add stock.', ephemeral: true });
        }

        const productId = interaction.options.getString('product_id').toUpperCase();
        const amount = interaction.options.getInteger('amount');

        const product = db.getProductById(productId);
        if (!product) {
            return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        const newStock = product.stock + amount;
        db.updateProductStock(product.product_id, newStock);

        const embed = new EmbedBuilder()
            .setTitle('📦 Stock Added')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Product', value: \`\${product.name} (\${product.product_id})\`, inline: true },
                { name: 'Added', value: \`+\${amount}\`, inline: true },
                { name: 'New Stock', value: \`\${newStock}\`, inline: true }
            )
            .setTimestamp();

        console.log(\`📦 Stock added to \${product.product_id}: +\${amount}\`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Add Payment Method command
    const addPmCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

const PAYMENT_TYPES = {
    'crypto': {
        emoji: '🪙',
        detection: 'Automatic',
        color: 0x00FF00,
        examples: 'LTC, BTC, ETH',
        notes: 'Uses wallet/API to check blockchain. Fully automated delivery possible.'
    },
    'giftcard': {
        emoji: '🎁',
        detection: 'Manual',
        color: 0xFFAA00,
        examples: 'Robux, Amazon, Steam, iTunes, Google Play',
        notes: 'Owner verification required. User provides code, owner confirms manually.'
    },
    'paypal': {
        emoji: '💸',
        detection: 'Semi-automatic',
        color: 0x0070BA,
        examples: 'PayPal, Cash App, Venmo',
        notes: 'Can use webhooks for automation, otherwise manual confirmation.'
    },
    'credits': {
        emoji: '💰',
        detection: 'Automatic',
        color: 0xFFD700,
        examples: 'Bot credits, Store points',
        notes: 'Internal currency. User tops up with other methods, then spends credits.'
    },
    'bank': {
        emoji: '🏦',
        detection: 'Manual',
        color: 0x808080,
        examples: 'IBAN, SWIFT, Wire Transfer',
        notes: 'Slow, requires manual verification. Good for large transactions.'
    }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addpm')
        .setDescription('Add a payment method (Owner only)')
        .addStringOption(option => 
            option.setName('type')
                .setDescription('Payment type')
                .setRequired(true)
                .addChoices(
                    { name: '🪙 Crypto (LTC, BTC, ETH) - Automatic', value: 'crypto' },
                    { name: '🎁 Gift Card (Robux, Amazon, Steam) - Manual', value: 'giftcard' },
                    { name: '💸 PayPal/CashApp/Venmo - Semi-auto', value: 'paypal' },
                    { name: '💰 Store Credits - Automatic', value: 'credits' },
                    { name: '🏦 Bank Transfer - Manual', value: 'bank' }
                )
        )
        .addStringOption(option => option.setName('name').setDescription('Payment method name (e.g., "Robux Gift Card")').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('Custom description').setRequired(false)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can add payment methods.', ephemeral: true });
        }

        const type = interaction.options.getString('type');
        const name = interaction.options.getString('name');
        const customDesc = interaction.options.getString('description');
        const typeInfo = PAYMENT_TYPES[type];

        const existing = db.getPaymentMethodByName(name);
        if (existing) {
            return interaction.reply({ content: '❌ Payment method already exists.', ephemeral: true });
        }

        const description = customDesc || typeInfo.notes;
        db.addPaymentMethod(name, description, type);

        const embed = new EmbedBuilder()
            .setTitle(\`\${typeInfo.emoji} Payment Method Added\`)
            .setColor(typeInfo.color)
            .addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Type', value: type.charAt(0).toUpperCase() + type.slice(1), inline: true },
                { name: 'Detection', value: typeInfo.detection, inline: true },
                { name: 'Description', value: description },
                { name: 'How it works', value: typeInfo.notes }
            )
            .setFooter({ text: \`Examples: \${typeInfo.examples}\` })
            .setTimestamp();

        console.log(\`💳 Payment method added: \${name} (\${type})\`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Payment Methods command
    const paymentMethodsCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

const TYPE_EMOJIS = {
    'crypto': '🪙',
    'giftcard': '🎁',
    'paypal': '💸',
    'credits': '💰',
    'bank': '🏦'
};

const DETECTION_INFO = {
    'crypto': '✅ Automatic',
    'giftcard': '⚠️ Manual',
    'paypal': '🔄 Semi-auto',
    'credits': '✅ Automatic',
    'bank': '⚠️ Manual'
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('paymentmethods')
        .setDescription('View available payment methods'),

    async execute(interaction, client) {
        const methods = db.getPaymentMethods();

        const embed = new EmbedBuilder()
            .setTitle('💳 Payment Methods')
            .setColor(0x00AAFF)
            .setDescription('Available payment methods for purchases:\\n\\n**Detection Types:**\\n✅ Automatic - Instant delivery\\n🔄 Semi-auto - May need confirmation\\n⚠️ Manual - Owner must confirm')
            .addFields({ 
                name: '🪙 LTC (Litecoin)', 
                value: '✅ Automatic | Default crypto payment', 
                inline: false 
            })
            .setTimestamp();

        for (const method of methods) {
            const emoji = TYPE_EMOJIS[method.type] || '💳';
            const detection = DETECTION_INFO[method.type] || '⚠️ Manual';
            embed.addFields({
                name: \`\${emoji} \${method.name}\`,
                value: \`\${detection} | \${method.description || 'No description'}\`,
                inline: false
            });
        }

        embed.setFooter({ text: 'Use /buy <product_id> payment_method:<name> to pay with a specific method' });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Confirm Order command
    const confirmOrderCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('confirmorder')
        .setDescription('Confirm payment for an order (Owner only)')
        .addStringOption(option => option.setName('order_id').setDescription('Order ID (e.g., ORD-1234)').setRequired(true)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can confirm orders.', ephemeral: true });
        }

        const orderId = interaction.options.getString('order_id').toUpperCase();
        const order = db.getOrderById(orderId);

        if (!order) {
            return interaction.reply({ content: '❌ Order not found.', ephemeral: true });
        }

        if (order.status !== 'pending') {
            return interaction.reply({ content: \`❌ Order is already \${order.status}.\`, ephemeral: true });
        }

        const product = db.getProductById(order.product_id);

        // Mark as paid
        db.updateOrderStatus(order.order_id, 'paid', 'MANUAL-' + Date.now());
        client.pendingOrders.delete(order.order_id);

        // Deliver key automatically
        const key = db.getAvailableKey(order.product_id);
        let deliveredKey = null;

        if (key) {
            db.markKeyUsed(key.id, order.user_id);
            db.updateProductStock(order.product_id, db.getProductKeyCount(order.product_id));
            db.markOrderDelivered(order.order_id, key.key_value);
            deliveredKey = key.key_value;
        } else {
            db.updateOrderStatus(order.order_id, 'paid');
        }

        // Notify buyer
        try {
            const buyer = await client.users.fetch(order.user_id);
            
            await buyer.send({
                embeds: [{
                    color: 0x00FF00,
                    title: '✅ Payment Confirmed!',
                    description: \`Your payment for **\${product?.name || 'your order'}** was confirmed!\`,
                    fields: [
                        { name: 'Order ID', value: order.order_id, inline: true },
                        { name: 'Amount', value: \`\${order.amount} LTC\`, inline: true }
                    ],
                    timestamp: new Date().toISOString()
                }]
            });

            if (deliveredKey) {
                await buyer.send({
                    embeds: [{
                        color: 0x00AAFF,
                        title: '📦 Product Delivered!',
                        fields: [{ name: '🔑 Your Key', value: \`\\\`\\\`\\\`\${deliveredKey}\\\`\\\`\\\`\` }]
                    }]
                });
            }

            // Send vouch prompt
            const priceUSD = (order.amount * 100).toFixed(2); // Approximate USD conversion
            await buyer.send({
                embeds: [{
                    color: 0xFFD700,
                    title: '⭐ Thank You For Your Purchase!',
                    description: \`If you're satisfied, please vouch for us in <#\${client.config.VOUCH_CHANNEL_ID}>!\`,
                    fields: [
                        { name: '📝 Copy & Paste This:', value: \`\\\`+vouch <@\${client.config.BOT_OWNER_ID}> \${product?.name || 'Product'} x1 $\${priceUSD}\\\`\` }
                    ],
                    footer: { text: 'Your feedback helps us grow!' }
                }]
            });
        } catch (e) {
            console.error('❌ Could not notify buyer:', e.message);
        }

        const embed = new EmbedBuilder()
            .setTitle('✅ Order Confirmed')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Order ID', value: order.order_id, inline: true },
                { name: 'Product', value: product?.name || order.product_id, inline: true },
                { name: 'Key Delivered', value: deliveredKey ? 'Yes' : 'No keys available', inline: true }
            )
            .setTimestamp();

        console.log(\`✅ Order confirmed: \${order.order_id}\`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Redeem Key command
    const redeemKeyCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('redeemkey')
        .setDescription('Redeem your product key if you did not receive it')
        .addStringOption(option => option.setName('order_id').setDescription('Order ID (e.g., ORD-1234)').setRequired(true)),

    async execute(interaction, client) {
        const orderId = interaction.options.getString('order_id').toUpperCase();
        const order = db.getOrderById(orderId);

        if (!order) {
            return interaction.reply({ content: '❌ Order not found.', ephemeral: true });
        }

        if (order.user_id !== interaction.user.id) {
            return interaction.reply({ content: '❌ This is not your order.', ephemeral: true });
        }

        if (order.status === 'pending') {
            return interaction.reply({ content: '❌ Payment not yet confirmed for this order.', ephemeral: true });
        }

        if (order.status === 'refunded') {
            return interaction.reply({ content: '❌ This order has been refunded.', ephemeral: true });
        }

        if (order.delivered_key) {
            // Re-send the key
            const embed = new EmbedBuilder()
                .setTitle('🔑 Your Product Key')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Order ID', value: order.order_id, inline: true },
                    { name: 'Key', value: \`\\\`\\\`\\\`\${order.delivered_key}\\\`\\\`\\\`\` }
                )
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // Try to deliver a key now
        const key = db.getAvailableKey(order.product_id);
        
        if (!key) {
            return interaction.reply({ content: '❌ No keys available for this product. Please contact support.', ephemeral: true });
        }

        db.markKeyUsed(key.id, order.user_id);
        db.updateProductStock(order.product_id, db.getProductKeyCount(order.product_id));
        db.markOrderDelivered(order.order_id, key.key_value);

        const embed = new EmbedBuilder()
            .setTitle('🔑 Product Key Delivered!')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Order ID', value: order.order_id, inline: true },
                { name: 'Key', value: \`\\\`\\\`\\\`\${key.key_value}\\\`\\\`\\\`\` }
            )
            .setTimestamp();

        console.log(\`🔑 Key redeemed for order \${order.order_id}\`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Set ID command (server config)
    const setIdCmd = `const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set_id')
        .setDescription('Configure server IDs (Owner/Admin only)')
        .addStringOption(option =>
            option.setName('setting')
                .setDescription('What to configure')
                .setRequired(true)
                .addChoices(
                    { name: 'LTC Address', value: 'ltc_address' },
                    { name: 'LTC QR URL', value: 'ltc_qr_url' },
                    { name: 'Vouch Channel', value: 'vouch_channel_id' },
                    { name: 'Log Channel', value: 'log_channel_id' }
                ))
        .addStringOption(option =>
            option.setName('value')
                .setDescription('The new value (channel ID, address, or URL)')
                .setRequired(true)),

    async execute(interaction, client) {
        const isOwner = interaction.user.id === client.config.BOT_OWNER_ID;
        const isAdmin = db.isServerAdmin(interaction.guild.id, interaction.user.id);

        if (!isOwner && !isAdmin) {
            return interaction.reply({ content: '❌ Only the bot owner or server admins can use this command.', ephemeral: true });
        }

        const setting = interaction.options.getString('setting');
        const value = interaction.options.getString('value');
        const guildId = interaction.guild.id;

        const config = {};
        config[setting] = value;

        db.upsertServerConfig(guildId, config);

        const settingNames = {
            'ltc_address': 'LTC Address',
            'ltc_qr_url': 'LTC QR URL',
            'vouch_channel_id': 'Vouch Channel',
            'log_channel_id': 'Log Channel'
        };

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Server Config Updated')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Setting', value: settingNames[setting], inline: true },
                { name: 'Value', value: setting.includes('channel') ? \`<#\${value}>\` : \`\\\`\${value}\\\`\`, inline: true },
                { name: 'Server', value: interaction.guild.name, inline: true }
            )
            .setTimestamp();

        console.log(\`⚙️ Config updated for \${guildId}: \${setting} = \${value}\`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Add Admin command
    const addAdminCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addadmin')
        .setDescription('Add a server admin (Owner only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to add as admin')
                .setRequired(true)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can add admins.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const guildId = interaction.guild.id;

        const added = db.addServerAdmin(guildId, user.id, interaction.user.id);

        if (!added) {
            return interaction.reply({ content: \`❌ \${user.tag} is already an admin.\`, ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('✅ Admin Added')
            .setColor(0x00FF00)
            .addFields(
                { name: 'User', value: \`\${user.tag} (\${user.id})\`, inline: true },
                { name: 'Server', value: interaction.guild.name, inline: true }
            )
            .setTimestamp();

        console.log(\`👑 Admin added: \${user.tag} for server \${guildId}\`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Remove Admin command
    const removeAdminCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removeadmin')
        .setDescription('Remove a server admin (Owner only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to remove as admin')
                .setRequired(true)),

    async execute(interaction, client) {
        if (interaction.user.id !== client.config.BOT_OWNER_ID) {
            return interaction.reply({ content: '❌ Only the bot owner can remove admins.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const guildId = interaction.guild.id;

        db.removeServerAdmin(guildId, user.id);

        const embed = new EmbedBuilder()
            .setTitle('✅ Admin Removed')
            .setColor(0xFF0000)
            .addFields(
                { name: 'User', value: \`\${user.tag} (\${user.id})\`, inline: true },
                { name: 'Server', value: interaction.guild.name, inline: true }
            )
            .setTimestamp();

        console.log(\`👑 Admin removed: \${user.tag} from server \${guildId}\`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Server Config command
    const serverConfigCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverconfig')
        .setDescription('View server configuration (Owner/Admin only)'),

    async execute(interaction, client) {
        const isOwner = interaction.user.id === client.config.BOT_OWNER_ID;
        const isAdmin = db.isServerAdmin(interaction.guild.id, interaction.user.id);

        if (!isOwner && !isAdmin) {
            return interaction.reply({ content: '❌ Only the bot owner or server admins can use this command.', ephemeral: true });
        }

        const guildId = interaction.guild.id;
        const config = db.getServerConfig(guildId);
        const admins = db.getServerAdmins(guildId);
        const products = db.getProducts(guildId);

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Server Configuration')
            .setColor(0x00AAFF)
            .addFields(
                { name: '🆔 Server ID', value: guildId, inline: true },
                { name: '📦 Products', value: \`\${products.length}\`, inline: true },
                { name: '👑 Admins', value: admins.length > 0 ? admins.map(a => \`<@\${a.user_id}>\`).join(', ') : 'None', inline: false }
            )
            .setTimestamp();

        if (config) {
            embed.addFields(
                { name: '💰 LTC Address', value: config.ltc_address || 'Not set', inline: true },
                { name: '📷 QR URL', value: config.ltc_qr_url ? 'Set ✅' : 'Not set', inline: true },
                { name: '⭐ Vouch Channel', value: config.vouch_channel_id ? \`<#\${config.vouch_channel_id}>\` : 'Not set', inline: true },
                { name: '📝 Log Channel', value: config.log_channel_id ? \`<#\${config.log_channel_id}>\` : 'Not set', inline: true }
            );
        } else {
            embed.addFields({ name: '⚠️ Status', value: 'No configuration set. Use /set_id to configure.' });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Help command
    const helpCmd = `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands'),

    async execute(interaction, client) {
        const isOwner = interaction.user.id === client.config.BOT_OWNER_ID;
        const isAdmin = db.isServerAdmin(interaction.guild?.id, interaction.user.id);

        const embed = new EmbedBuilder()
            .setTitle('📚 Bot Commands')
            .setColor(0x00AAFF)
            .setDescription('Here are all available commands:')
            .addFields(
                { name: '🛒 Customer Commands', value: 
                    \`**/products** - View all available products
**/buy <product_id>** - Purchase a product
**/orders** - View your order history
**/orderinfo <order_id>** - View details of a specific order
**/redeemkey <order_id>** - Redeem your product key
**/paymentmethods** - View available payment methods
**/help** - Show this help message\`
                }
            )
            .setTimestamp();

        if (isOwner || isAdmin) {
            embed.addFields(
                { name: '⚙️ Admin Commands', value: 
                    \`**/set_id** - Configure server settings
**/serverconfig** - View server configuration
**/addproduct** - Add a new product
**/editproduct** - Edit an existing product
**/deleteproduct** - Delete a product
**/addkey** - Add product keys
**/addstock** - Add stock to a product
**/stock** - View product stock overview
**/addpm** - Add a payment method
**/confirmorder** - Confirm payment for an order
**/refund** - Refund an order\`
                }
            );
        }

        if (isOwner) {
            embed.addFields(
                { name: '👑 Owner Only', value: 
                    \`**/addadmin** - Add a server admin
**/removeadmin** - Remove a server admin\`
                }
            );
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};`;

    // Payment Checker service
    const paymentCheckerSvc = `const axios = require('axios');
const db = require('../database');

const CHECK_INTERVAL = 25000;
const MIN_CONFIRMATIONS = 1;
const ORDER_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

module.exports = {
    start(client) {
        console.log('🔄 Payment checker started (25s interval)');
        this.checkPayments(client);
        setInterval(() => this.checkPayments(client), CHECK_INTERVAL);
    },

    async checkPayments(client) {
        try {
            const pending = db.prepare("SELECT * FROM orders WHERE status = 'pending' AND payment_method = 'ltc'").all();
            if (pending.length === 0) return;

            console.log(\`🔍 Checking \${pending.length} pending LTC order(s)...\`);
            
            for (const order of pending) {
                // Check for expired orders
                const orderAge = Date.now() - (order.created_at * 1000);
                if (orderAge > ORDER_EXPIRY_MS) {
                    console.log(\`⏰ Order \${order.order_id} expired\`);
                    db.updateOrderStatus(order.order_id, 'cancelled');
                    client.pendingOrders.delete(order.order_id);
                    
                    // Notify user
                    try {
                        const user = await client.users.fetch(order.user_id);
                        await user.send({
                            embeds: [{
                                color: 0xFF0000,
                                title: '⏰ Order Expired',
                                description: \`Your order **\${order.order_id}** has expired due to no payment received.\`,
                                timestamp: new Date().toISOString()
                            }]
                        });
                    } catch (e) {
                        console.error('❌ Could not notify user:', e.message);
                    }
                    continue;
                }
                
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
            console.error(\`❌ Order \${order.order_id} check failed:\`, e.message);
        }
    },

    async processPayment(order, tx, client) {
        console.log(\`✅ Payment confirmed for order \${order.order_id}\`);
        
        db.prepare("UPDATE orders SET status = 'paid', txid = ? WHERE order_id = ?").run(tx.txid, order.order_id);
        db.addTransaction(order.order_id, tx.txid, parseFloat(tx.value), tx.confirmations);
        client.pendingOrders.delete(order.order_id);

        const product = db.getProductById(order.product_id);
        
        try {
            const user = await client.users.fetch(order.user_id);
            await user.send({
                embeds: [{
                    color: 0x00FF00,
                    title: '✅ Payment Confirmed!',
                    description: \`Your payment for **\${product?.name || 'your order'}** was received!\`,
                    fields: [
                        { name: 'Order ID', value: order.order_id, inline: true },
                        { name: 'Amount', value: \`\${order.amount} LTC\`, inline: true },
                        { name: 'TXID', value: \`\\\`\${tx.txid}\\\`\` }
                    ]
                }]
            });

            // Deliver product key automatically
            const key = db.getAvailableKey(order.product_id);
            if (key) {
                db.markKeyUsed(key.id, order.user_id);
                db.updateProductStock(order.product_id, db.getProductKeyCount(order.product_id));
                db.markOrderDelivered(order.order_id, key.key_value);
                
                await user.send({
                    embeds: [{
                        color: 0x00AAFF,
                        title: '📦 Product Delivered!',
                        fields: [{ name: '🔑 Your Key', value: \`\\\`\\\`\\\`\${key.key_value}\\\`\\\`\\\`\` }]
                    }]
                });

                // Send vouch prompt
                const priceUSD = (order.amount * 100).toFixed(2); // Approximate USD conversion
                await user.send({
                    embeds: [{
                        color: 0xFFD700,
                        title: '⭐ Thank You For Your Purchase!',
                        description: \`If you're satisfied, please vouch for us in <#\${client.config.VOUCH_CHANNEL_ID}>!\`,
                        fields: [
                            { name: '📝 Copy & Paste This:', value: \`\\\`+vouch <@\${client.config.BOT_OWNER_ID}> \${product?.name || 'Product'} x1 $\${priceUSD}\\\`\` }
                        ],
                        footer: { text: 'Your feedback helps us grow!' }
                    }]
                });
                
                console.log(\`📦 Key delivered for order \${order.order_id}\`);
            } else {
                console.log(\`⚠️ No keys available for order \${order.order_id}\`);
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
    fs.writeFileSync(path.join(commandsPath, 'orderinfo.js'), orderInfoCmd);
    fs.writeFileSync(path.join(commandsPath, 'refund.js'), refundCmd);
    fs.writeFileSync(path.join(commandsPath, 'addstock.js'), addStockCmd);
    fs.writeFileSync(path.join(commandsPath, 'addpm.js'), addPmCmd);
    fs.writeFileSync(path.join(commandsPath, 'paymentmethods.js'), paymentMethodsCmd);
    fs.writeFileSync(path.join(commandsPath, 'confirmorder.js'), confirmOrderCmd);
    fs.writeFileSync(path.join(commandsPath, 'redeemkey.js'), redeemKeyCmd);
    fs.writeFileSync(path.join(commandsPath, 'set_id.js'), setIdCmd);
    fs.writeFileSync(path.join(commandsPath, 'addadmin.js'), addAdminCmd);
    fs.writeFileSync(path.join(commandsPath, 'removeadmin.js'), removeAdminCmd);
    fs.writeFileSync(path.join(commandsPath, 'serverconfig.js'), serverConfigCmd);
    fs.writeFileSync(path.join(commandsPath, 'help.js'), helpCmd);
    fs.writeFileSync(path.join(servicesPath, 'paymentChecker.js'), paymentCheckerSvc);

    console.log('✅ Created 20 command files + payment checker');
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
    VOUCH_CHANNEL_ID,
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
    
    // Handle button interactions
    if (interaction.isButton()) {
        const [action, orderId] = interaction.customId.split('_');
        
        if (action === 'check') {
            const order = db.getOrderById(orderId);
            if (!order) {
                return interaction.reply({ content: '❌ Order not found.', ephemeral: true });
            }
            
            const statusEmoji = {
                'pending': '⏳',
                'paid': '✅',
                'delivered': '📦',
                'refunded': '💸',
                'cancelled': '❌'
            }[order.status] || '❓';
            
            await interaction.reply({ 
                content: `${statusEmoji} Order **${orderId}** status: **${order.status.toUpperCase()}**`, 
                ephemeral: true 
            });
        }
        
        if (action === 'cancel') {
            const order = db.getOrderById(orderId);
            if (!order) {
                return interaction.reply({ content: '❌ Order not found.', ephemeral: true });
            }
            
            if (order.user_id !== interaction.user.id) {
                return interaction.reply({ content: '❌ This is not your order.', ephemeral: true });
            }
            
            if (order.status !== 'pending') {
                return interaction.reply({ content: `❌ Cannot cancel order with status: ${order.status}`, ephemeral: true });
            }
            
            db.updateOrderStatus(orderId, 'cancelled');
            client.pendingOrders.delete(orderId);
            
            await interaction.reply({ content: `✅ Order **${orderId}** has been cancelled.`, ephemeral: true });
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
        client.pendingOrders.set(order.order_id, order);
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

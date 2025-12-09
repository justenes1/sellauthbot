const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./database');

// ========================
// Configuration (Hardcoded)
// ========================
const CLIENT_ID = '1447366056904491079';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // Keep token in .env for security
const LTC_ADDRESS = 'Lendcpxh1hrmCePoKiNx8otRksC1TG8T8H';
const LTC_QR_CODE_URL = 'https://cdn.discordapp.com/attachments/1444350061298323486/1447379141795123251/Screenshot_20251207-1859392.png?ex=6937685e&is=693616de&hm=486054c108876e5188d9e49a0b5db96ded2ecbf34f7e1a405c3220f61375c887&';
const BOT_OWNER_ID = '1425207525166551261';
const BLOCKCYPHER_API_KEY = 'bf863a82813746c2ae97fcca1ba7f4a7';

// Confirmation thresholds based on amount (LTC)
const CONFIRMATION_THRESHOLDS = {
    small: { maxAmount: 0.1, confirmations: 1 },   // < 0.1 LTC = 1 confirmation
    medium: { maxAmount: 1, confirmations: 3 },    // < 1 LTC = 3 confirmations
    large: { maxAmount: 10, confirmations: 6 },    // < 10 LTC = 6 confirmations
    xlarge: { confirmations: 10 }                  // >= 10 LTC = 10 confirmations
};

// Log loaded configuration
console.log("📦 Config loaded:", { 
    CLIENT_ID: "✓ Set",
    DISCORD_TOKEN: DISCORD_TOKEN ? "✓ Set" : "✗ Missing (check .env)",
    LTC_ADDRESS: "✓ Set",
    LTC_QR_CODE_URL: "✓ Set",
    BOT_OWNER_ID: "✓ Set",
    BLOCKCYPHER_API_KEY: "✓ Set"
});

// Validate Discord token
if (!DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN missing! Add it to your .env file.");
    process.exit(1);
}

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

// Make config accessible via client
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
client.pendingProducts = new Map(); // For tracking /addproduct conversations
client.pendingOrders = new Map();   // For tracking pending payments

// ========================
// Load Commands
// ========================
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    const commands = [];

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commands.push(command.data.toJSON());
            console.log(`📌 Loaded command: ${command.data.name}`);
        }
    }

    // Store commands array for registration
    client.commandsArray = commands;
} else {
    console.log("⚠️ No commands folder found. Creating one...");
    fs.mkdirSync(commandsPath, { recursive: true });
    client.commandsArray = [];
}

// ========================
// Register Slash Commands
// ========================
async function registerCommands() {
    if (!client.commandsArray || client.commandsArray.length === 0) {
        console.log("⚠️ No commands to register.");
        return;
    }

    const rest = new REST().setToken(DISCORD_TOKEN);
    try {
        console.log('🔄 Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: client.commandsArray }
        );
        console.log(`✅ Registered ${client.commandsArray.length} slash commands!`);
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

// ========================
// Handle Interactions
// ========================
client.on('interactionCreate', async interaction => {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`❌ Error executing command ${interaction.commandName}:`, error);
            const reply = { content: '❌ There was an error executing this command!', ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }
    }

    // Handle button interactions
    if (interaction.isButton()) {
        const handlerPath = path.join(__dirname, 'handlers', 'buttonHandler.js');
        if (fs.existsSync(handlerPath)) {
            const handler = require(handlerPath);
            await handler.execute(interaction, client);
        }
    }

    // Handle select menu interactions
    if (interaction.isStringSelectMenu()) {
        const handlerPath = path.join(__dirname, 'handlers', 'selectHandler.js');
        if (fs.existsSync(handlerPath)) {
            const handler = require(handlerPath);
            await handler.execute(interaction, client);
        }
    }
});

// ========================
// Handle Messages (for /addproduct flow)
// ========================
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    const pending = client.pendingProducts.get(message.author.id);
    if (!pending) return;

    const handlerPath = path.join(__dirname, 'handlers', 'productFlowHandler.js');
    if (fs.existsSync(handlerPath)) {
        const handler = require(handlerPath);
        await handler.execute(message, client, pending);
    }
});

// ========================
// Bot Ready Event
// ========================
client.once('ready', async () => {
    console.log(`\n========================================`);
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
    console.log(`========================================\n`);

    // Register slash commands
    await registerCommands();
    
    // Start payment checker
    const paymentChecker = require('./services/paymentChecker');
    paymentChecker.start(client);

    // Load pending orders from database into memory
    try {
        const pendingOrders = db.prepare("SELECT * FROM orders WHERE status = 'pending'").all();
        for (const order of pendingOrders) {
            client.pendingOrders.set(order.id, {
                orderId: order.id,
                userId: order.user_id,
                productId: order.product_id,
                ltcAddress: order.ltc_address,
                amount: order.amount,
                createdAt: order.created_at
            });
        }
        console.log(`📋 Loaded ${pendingOrders.length} pending orders from database`);
    } catch (error) {
        console.error("❌ Error loading pending orders:", error);
    }
});

// ========================
// Error Handling
// ========================
client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

// ========================
// Start the Bot
// ========================
client.login(DISCORD_TOKEN);

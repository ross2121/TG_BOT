export const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
export const TELEGRAM_API = process.env.TELEGRAM_API || "";
export const CRYPTO_SECRET = process.env.CRYPTO_SECRET || 'your-secret-key-change-this';

export const DEFAULT_KEYBOARD = [
    ["📊 Track Wallet Positions"],
    ["🔐 Create New Wallet"],
    ["🔄 Swap Tokens"],
    ["💼 Manage Wallet"],
    ["🚀 Start Strategy"],
    ["⏹️ Stop Strategy"],
    ["📈 Exit Position"]
];

export const IL_THRESHOLD = -5;
export const IL_NOTIFICATION_STEP = 2.5;
export const VALUE_CHANGE_THRESHOLD = 10;
export const MONITOR_INTERVAL = 900000;
export const STRATEGY_CHECK_INTERVAL = 3600000;

# Saros DLMM Telegram Bot

A comprehensive Telegram bot for managing Saros DLMM (Dynamic Liquidity Market Maker) positions with automated strategy execution and monitoring.

## Features

### 🤖 Core Bot Functions
- **Wallet Management**: Create, encrypt, and manage Solana wallets
- **Position Tracking**: Monitor DLMM liquidity positions with real-time alerts
- **Token Swapping**: Execute token swaps with custom slippage settings
- **Impermanent Loss Monitoring**: Track IL with configurable thresholds and alerts

### 🚀 Cleopatra Spot Strategy
- **Pool Analysis**: Automatically finds the best pools by APR and fees
- **Auto-Swap**: Executes 50/50 token swaps for balanced positions
- **Concentrated Liquidity**: Creates ±20 bin positions around current price
- **Auto-Rebalancing**: Hourly monitoring and position adjustments
- **Compounding**: Automatic earnings reinvestment for growth

### 📊 Monitoring & Alerts
- **Value Change Alerts**: Notifications when position value changes ±10%
- **Impermanent Loss Warnings**: Alerts when IL crosses -5% threshold
- **Recovery Notifications**: Positive alerts when IL recovers
- **Out-of-Range Detection**: Warns when positions move outside active bins

## Installation

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Telegram Bot Token
- Solana RPC endpoint

### Setup

1. **Clone and Install**
```bash
git clone <repository-url>
cd Saros
npm install
```

2. **Environment Configuration**
Create a `.env` file:
```env
TELEGRAM_API=your_telegram_bot_token
RPC_URL=https://api.mainnet-beta.solana.com
CRYPTO_SECRET=your_encryption_secret_key
DATABASE_URL=postgresql://postgres:password@localhost:5432/saros_bot
```

3. **Database Setup**
```bash
# Start PostgreSQL with Docker
docker run --name saros-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=saros_bot -p 5432:5432 -d postgres

# Run database migrations
npx prisma db push
```

4. **Build and Run**
```bash
npm run build
npm start
```

## Usage

### Bot Commands

#### Wallet Management
- `/start` - Initialize the bot and show main menu
- **Create New Wallet** - Generate a new Solana wallet with encrypted private key
- **Manage Wallet** - View wallet info, disconnect wallet, or delete positions

#### Position Tracking
- **Track Wallet Positions** - Analyze positions for any wallet/pool combination
- Enter pool address → Enter wallet address → View detailed position analysis

#### Trading
- **Swap Tokens** - Execute token swaps with custom parameters
- Enter input token mint → Output token mint → Amount → Slippage

#### Strategy Execution
- **Start Strategy** - Begin automated Cleopatra Spot Strategy
- **Stop Strategy** - Halt automated strategy execution
- **Exit Position** - Manually exit a specific position

### Strategy Details

The Cleopatra Spot Strategy automatically:

1. **Analyzes** all available Saros pools
2. **Selects** the pool with highest APR/fees
3. **Executes** 50/50 token swaps (e.g., SOL ↔ BONK)
4. **Creates** concentrated liquidity positions (±20 bins around current price)
5. **Monitors** hourly for rebalancing opportunities
6. **Compounds** earnings by reinvesting profits

## Project Structure

```
src/
├── services/
│   ├── auth.ts          # Wallet generation & encryption
│   ├── monitor.ts       # Position monitoring & IL alerts
│   └── swapHandler.ts   # Token swap flow handling
├── strategies/
│   └── strategy.ts      # Cleopatra Spot Strategy implementation
├── types/
│   └── index.ts         # TypeScript interfaces
├── utils/
│   └── constants.ts     # App constants & configuration
└── index.ts             # Main bot entry point
```

## Configuration

### Monitoring Settings
- **Monitor Interval**: 15 minutes (900,000ms)
- **Value Change Threshold**: ±10%
- **IL Warning Threshold**: -5%
- **IL Notification Step**: 2.5% increments

### Strategy Settings
- **Rebalance Interval**: 1 hour (3,600,000ms)
- **Position Range**: ±20 bins from current price
- **Pool Analysis**: Top 20 pools by volume
- **Slippage Tolerance**: 0.5% (50 bps)

## Database Schema

### User Model
```prisma
model User {
  id                    String    @id @default(cuid())
  telegram_id           String    @unique
  public_key            String
  encrypted_private_key String?
  encryption_iv         String?
  positions             Position[]
}
```

### Position Model
```prisma
model Position {
  id                     String @id @default(cuid())
  mint                   String
  lowerId                String
  upperId                String
  Market                 String
  Status                 Status
  Previous               Float  @default(0.0)
  
  # IL Calculation Fields
  initialTokenAAmount    Float  @default(0.0)
  initialTokenBAmount    Float  @default(0.0)
  initialTokenAPriceUSD  Float  @default(0.0)
  initialTokenBPriceUSD  Float  @default(0.0)
  lastILWarningPercent   Float  @default(0.0)
  
  userId                 String
  user                   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

## Security Features

- **Private Key Encryption**: AES-256-CBC encryption with scrypt key derivation
- **Secure Storage**: Encrypted private keys stored in database
- **One-time Display**: Private keys shown only once during wallet creation
- **Wallet Disconnection**: Complete removal of wallet data and positions

## API Integrations

- **Saros DLMM SDK**: Pool data, position management, liquidity operations
- **Jupiter API**: Real-time token prices and swap quotes
- **Solana Web3.js**: Blockchain interactions and transaction handling

## Monitoring & Alerts

### Value Change Monitoring
- Tracks position value every 15 minutes
- Alerts when value changes ±10% from previous check
- Includes current token amounts and USD values

### Impermanent Loss Tracking
- Stores initial position state (token amounts + prices)
- Calculates "Value if Held" vs "Current Position Value"
- Triggers alerts at -5% IL threshold
- Additional alerts every 2.5% worsening
- Recovery notifications when IL turns positive

### Position Health Checks
- Detects out-of-range positions
- Monitors active bin positions
- Syncs new on-chain positions automatically

## Development

### Scripts
```bash
npm run build    # Compile TypeScript
npm start        # Run the bot
npm run dev      # Development mode with hot reload
```

### Dependencies
- **@saros-finance/dlmm-sdk**: Saros DLMM integration
- **@solana/web3.js**: Solana blockchain interactions
- **telegraf**: Telegram bot framework
- **prisma**: Database ORM
- **axios**: HTTP client for API calls

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify PostgreSQL is running on port 5432
   - Check DATABASE_URL in .env file
   - Ensure database exists and user has permissions

2. **RPC Connection Issues**
   - Verify RPC_URL is accessible
   - Consider using a premium RPC provider for better reliability

3. **Telegram Bot Not Responding**
   - Verify TELEGRAM_API token is correct
   - Check bot permissions and webhook settings

4. **Strategy Execution Failures**
   - Ensure wallet has sufficient SOL for transactions
   - Verify pool addresses are valid and active
   - Check network congestion and retry if needed

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review logs for error messages
3. Verify all environment variables are set correctly
4. Ensure all dependencies are properly installed

---

**⚠️ Disclaimer**: This bot handles real cryptocurrency transactions. Always test with small amounts first and ensure you understand the risks involved in automated trading and liquidity provision.

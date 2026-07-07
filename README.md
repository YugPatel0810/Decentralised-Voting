# Decentralized Voting System

A fully decentralized voting application built on the Ethereum blockchain (via Ganache) and IPFS (via Pinata).

## Architectural Overview

This system uses a dual-web-app architecture:
1. **Public Interface (`index.html`, `login.html`)**: Allows voters to authenticate via their MetaMask wallet and cast immutable votes on-chain.
2. **Administrative Dashboard (`admin.html`)**: Allows the election administrator to manage candidates, set election dates, and configure the voter whitelist.

### Core Technologies
- **Ethereum Smart Contracts (Solidity `^0.8.20`)**: Stores IPFS CIDs mapping to candidates, metadata, and whitelists, plus tallies votes securely.
- **IPFS (Pinata)**: Stores the actual JSON payloads for candidates, election dates, voter whitelists, and voting receipts, ensuring off-chain data is immutable and decentralized.
- **Node.js / Express**: Serves the frontend and provides a secure proxy relay (`/api/ipfs/upload`) to pin JSON to IPFS without exposing Pinata API keys to the browser.
- **Vanilla JS & Web3.js**: Interacts with the blockchain and IPFS gateways.
- **Stripi UI Design**: A modern, clean design system.

---

## Requirements

- Node.js (version 18+)
- MetaMask (Browser Extension)
- Ganache (Local Blockchain Testnet)
- A Pinata Account (for IPFS pinning)

---

## Setup & Execution

Follow these steps to run the project locally.

### 1. Configure Environment Variables
In the root directory of the project, edit the `.env` file and insert your API keys from your [Pinata Dashboard](https://app.pinata.cloud/developers/api-keys):

```env
PINATA_API_KEY="your-pinata-api-key"
PINATA_SECRET_API_KEY="your-pinata-secret-api-key"
PINATA_GATEWAY="https://gateway.pinata.cloud/ipfs"
```
*(If you have a dedicated Pinata Gateway, replace the URL above).*

### 2. Install Dependencies
Open a terminal in the project's root directory and run:
```bash
npm install
```

### 3. Start Local Blockchain
Open **Ganache** and start a workspace (Quickstart). Ensure it is running on `http://127.0.0.1:7545`.

### 4. Deploy Smart Contracts
In your terminal, compile and migrate the smart contracts to Ganache:
```bash
npx truffle migrate --reset
```
*Note: The wallet address Ganache uses to deploy the contract automatically becomes the **Admin**.*

### 5. Bundle Frontend Scripts
If you make changes to `src/js/app.js` or `src/js/login.js`, you must rebundle them using Browserify:
```bash
npx browserify ./src/js/app.js -o ./src/dist/app.bundle.js
npx browserify ./src/js/login.js -o ./src/dist/login.bundle.js
```

### 6. Start the Node Server
Start the Express server to serve the UI and proxy IPFS requests:
```bash
node index.js
```

---

## How to Use the App

The application should now be accessible at `http://localhost:8080/`.

### Administrative Setup
1. Open your browser and connect MetaMask to your local Ganache network (RPC URL: `http://127.0.0.1:7545`, Chain ID: 1337).
2. Import the **Deployer Account** (the first account in Ganache) into MetaMask using its private key.
3. Navigate to `http://localhost:8080/admin.html` (this page is protected and only the deployer wallet can access it).
4. **Configure Election Dates**: Use the *Define Voting Dates* card to upload schedule metadata to IPFS.
5. **Add Candidates**: Use the *Add Candidate* card to upload candidate details to IPFS.
6. **Set Voter Whitelist**: Use the *Voter Whitelist* card to define who can vote. The JSON must look like this:
   ```json
   {
     "voters": [
       {"address": "0xYourTestWalletAddress", "role": "user"},
       {"address": "0xDeployerWalletAddress", "role": "admin"}
     ]
   }
   ```
   Click "Upload Whitelist to IPFS".

### Voting (Public Interface)
1. Switch your MetaMask to a wallet address that is on the uploaded whitelist.
2. Navigate to `http://localhost:8080/`.
3. Click **"Connect Wallet to Login"**. The app will verify your address against the IPFS whitelist.
4. Select a candidate and cast your vote.
5. Upon successful voting, an immutable voting receipt will be pinned to IPFS, and the CID will be displayed.

---

## Code Structure

```text
├── build/                      # Compiled contract artifacts (Truffle)
├── contracts/                  # Solidity smart contracts (Voting.sol, Migrations.sol)
├── migrations/                 # Truffle deployment scripts
├── src/
│   ├── css/                    # Stripi Design System stylesheets
│   ├── dist/                   # Bundled JavaScript output
│   ├── html/                   # UI Templates (index, login, admin)
│   └── js/                     # Frontend logic (app.js, login.js)
├── index.js                    # Express Server & IPFS Relay Endpoint
├── truffle-config.js           # Truffle configuration
└── .env                        # Pinata API Keys configuration
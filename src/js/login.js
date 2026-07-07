const Web3 = require('web3');
const contract = require('@truffle/contract');
const votingArtifacts = require('../../build/contracts/Voting.json');

const PINATA_GATEWAY = "https://pink-actual-toad-685.mypinata.cloud/ipfs";

const loginError = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');
const loginBtnText = document.getElementById('login-btn-text');
const loginSpinner = document.getElementById('login-spinner');

// ── Helpers ────────────────────────────────────────────────
function showError(msg) {
  if (loginError) {
    loginError.textContent = msg;
    loginError.style.display = 'block';
  }
}

function hideError() {
  if (loginError) {
    loginError.style.display = 'none';
  }
}

function setLoading(loading) {
  if (loginBtn) loginBtn.disabled = loading;
  if (loginBtnText) loginBtnText.textContent = loading ? 'Verifying on IPFS…' : 'Connect Wallet to Login';
  if (loginSpinner) loginSpinner.style.display = loading ? 'inline-block' : 'none';
}


// ── Login Handler ──────────────────────────────────────────
loginBtn.addEventListener('click', async (event) => {
  event.preventDefault();
  hideError();
  setLoading(true);

  try {
    // 1. Connect to Ganache via Web3 (MetaMask)
    let web3Instance;
    if (typeof window.ethereum !== 'undefined') {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      web3Instance = new Web3(window.ethereum);
    } else {
      throw new Error('MetaMask is not installed. Please install it to continue.');
    }

    const accounts = await web3Instance.eth.getAccounts();
    if (accounts.length === 0) {
      throw new Error('No accounts found. Please unlock MetaMask.');
    }
    const userAddress = accounts[0].toLowerCase();

    // 2. Load the Voting contract
    const VotingContract = contract(votingArtifacts);
    VotingContract.setProvider(web3Instance.currentProvider);
    const instance = await VotingContract.deployed();

    // 3. Check if the connected wallet is the Admin
    const adminAddress = await instance.admin();
    if (userAddress === adminAddress.toLowerCase()) {
      localStorage.setItem('dvote_voter_address', userAddress);
      localStorage.setItem('dvote_role', 'admin');
      window.location.replace('/admin.html');
      return;
    }

    // 4. Fetch the voter whitelist CID from the contract (for regular voters)
    const whitelistCID = await instance.voterWhitelistCID();

    if (!whitelistCID || whitelistCID === '') {
      showError('No voter whitelist has been configured yet. Contact the administrator.');
      setLoading(false);
      return;
    }

    // 5. Fetch the whitelist JSON from IPFS
    const gatewayUrl = PINATA_GATEWAY + '/' + whitelistCID;
    const response = await fetch(gatewayUrl);

    if (!response.ok) {
      throw new Error('Failed to fetch voter whitelist from IPFS');
    }

    const whitelistData = await response.json();
    const voterList = whitelistData.voters || [];

    // 5. Check if the wallet address exists in the whitelist
    // The whitelist supports two formats:
    //   Simple:   { "voters": ["0x...", "0x..."] }
    //   Extended: { "voters": [{"address":"0x...","role":"admin"}, ...] }
    let matchedVoter = null;

    if (voterList.length > 0 && typeof voterList[0] === 'object') {
      // Extended format with roles
      matchedVoter = voterList.find(
        v => v.address && v.address.toLowerCase() === userAddress
      );
    } else {
      // Simple format
      const found = voterList.find(addr => typeof addr === 'string' && addr.toLowerCase() === userAddress);
      if (found) {
        matchedVoter = { address: userAddress, role: 'user' };
      }
    }

    if (!matchedVoter) {
      showError('Wallet address not recognized. You are not on the voter whitelist.');
      setLoading(false);
      return;
    }

    // 6. Store auth and redirect
    localStorage.setItem('dvote_voter_address', matchedVoter.address);
    localStorage.setItem('dvote_role', matchedVoter.role || 'user');

    if (matchedVoter.role === 'admin') {
      window.location.replace('/admin.html');
    } else {
      window.location.replace('/index.html');
    }

  } catch (err) {
    console.error('Login error:', err);
    showError(err.message || 'Login failed.');
    setLoading(false);
  }
});

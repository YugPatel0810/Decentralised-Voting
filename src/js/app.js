const Web3 = require('web3');
const contract = require('@truffle/contract');
const votingArtifacts = require('../../build/contracts/Voting.json');

const PINATA_GATEWAY = "https://pink-actual-toad-685.mypinata.cloud/ipfs";

// ── Helpers ────────────────────────────────────────────────
async function uploadToIPFS(data) {
  const response = await fetch('/api/ipfs/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'IPFS upload failed');
  }
  const result = await response.json();
  return result.ipfsHash;
}

async function fetchFromIPFS(cid) {
  const url = PINATA_GATEWAY + '/' + cid;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error('Failed to fetch from IPFS: ' + cid);
    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Network Error: Unable to retrieve election data');
    }
    throw err;
  }
}

function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHTML(id, html) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function getVal(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}

function disable(id) {
  var el = document.getElementById(id);
  if (el) el.disabled = true;
}

function enable(id) {
  var el = document.getElementById(id);
  if (el) el.disabled = false;
}


// ── App Object ─────────────────────────────────────────────
window.App = {
  account: null,
  contractInstance: null,
  isAdmin: false,

  // ── Initialize ───────────────────────────────────────────
  eventStart: async function () {
    // Detect admin page by the hidden dashboard container
    var isAdminPage = !!document.getElementById('admin-dashboard-content');

    // ─── ADMIN ZERO-TRUST AUTH GATE ───────────────────────
    if (isAdminPage) {
      try {
        // Step 1: Environment Check — no MetaMask = instant deny
        if (typeof window.ethereum === 'undefined') {
          console.error('Unauthorized: No Web3 wallet detected.');
          window.location.replace('index.html');
          return;
        }

        // Step 2: Await Wallet Connection (strict)
        var accounts;
        try {
          accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        } catch (connErr) {
          console.error('Unauthorized: Wallet connection rejected.');
          window.location.replace('index.html');
          return;
        }
        if (!accounts || accounts.length === 0) {
          console.error('Unauthorized: No accounts found.');
          window.location.replace('index.html');
          return;
        }
        var currentUser = accounts[0].toLowerCase();

        // Step 3: Cryptographic Verification — owner() from contract
        var web3Instance = new Web3(window.ethereum);
        var VotingContract = contract(votingArtifacts);
        VotingContract.setProvider(web3Instance.currentProvider);
        VotingContract.defaults({ from: accounts[0], gas: 6654755 });

        var instance = await VotingContract.deployed();
        var contractOwner = (await instance.admin()).toLowerCase();

        // Step 4: Strict Conditional Routing
        if (currentUser !== contractOwner) {
          console.error('Unauthorized: Admin wallet required. Connected: ' + currentUser + ', Owner: ' + contractOwner);
          window.location.replace('index.html');
          return;
        }

        // ── AUTH PASSED — reveal dashboard ─────────────────
        App.account = accounts[0];
        App.contractInstance = instance;
        App.isAdmin = true;

        // Fade out overlay, reveal content
        var overlay = document.getElementById('admin-auth-overlay');
        var dashboard = document.getElementById('admin-dashboard-content');
        if (dashboard) dashboard.style.display = 'block';
        if (overlay) {
          overlay.classList.add('fade-out');
          setTimeout(function () { overlay.remove(); }, 500);
        }

        setText('accountAddress', 'Your Account: ' + App.account);

        // Step 5: Hardened event listeners — post-auth surveillance
        window.ethereum.on('accountsChanged', function (newAccounts) {
          // Immediately hide dashboard on ANY account change
          var dash = document.getElementById('admin-dashboard-content');
          if (dash) dash.style.display = 'none';

          if (!newAccounts || newAccounts.length === 0 ||
              newAccounts[0].toLowerCase() !== contractOwner) {
            console.error('Unauthorized: Admin wallet disconnected or changed.');
            window.location.replace('index.html');
          } else {
            window.location.reload();
          }
        });

        window.ethereum.on('disconnect', function () {
          var dash = document.getElementById('admin-dashboard-content');
          if (dash) dash.style.display = 'none';
          console.error('Unauthorized: Wallet disconnected.');
          window.location.replace('index.html');
        });

        // ── Load admin-specific data (only after auth) ────
        await App.loadElectionMetadata();
        await App.loadCandidates();
        App.bindAdminEvents();
        App.bindVerificationEvents();

      } catch (err) {
        console.error('Admin auth failure:', err);
        window.location.replace('index.html');
      }
      return; // Admin flow complete — do not fall through to voter flow
    }

    // ─── VOTER PAGE FLOW (unchanged) ──────────────────────
    try {
      var web3Instance;
      if (window.ethereum) {
        var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        web3Instance = new Web3(window.ethereum);
        App.account = accounts[0];
      } else {
        web3Instance = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:7545'));
        var accts = await web3Instance.eth.getAccounts();
        App.account = accts[0];
      }

      var VotingContract = contract(votingArtifacts);
      VotingContract.setProvider(web3Instance.currentProvider);
      VotingContract.defaults({ from: App.account, gas: 6654755 });

      var instance = await VotingContract.deployed();
      App.contractInstance = instance;

      var adminAddress = await instance.admin();
      App.isAdmin = (App.account.toLowerCase() === adminAddress.toLowerCase());

      setText('accountAddress', 'Your Account: ' + App.account);

      // Listen for account changes on voter page
      if (window.ethereum) {
        window.ethereum.on('accountsChanged', function () {
          window.location.reload();
        });
      }

      await App.loadElectionMetadata();
      await App.loadCandidates();

      // Check vote status (voter page)
      if (document.getElementById('voteButton')) {
        try {
          var voted = await instance.checkVote();
          if (!voted) {
            enable('voteButton');
          }
        } catch (err) {
          console.error('Error checking vote:', err.message);
        }

        // Circuit Breaker UI Check
        try {
          var isPaused = await App.contractInstance.paused();
          if (isPaused) {
            var banner = document.getElementById('circuit-breaker-banner');
            var vBtn = document.getElementById('voteButton');
            if (banner) banner.style.display = 'block';
            if (vBtn) {
              vBtn.disabled = true;
              vBtn.innerHTML = 'Voting Suspended';
            }
          }
        } catch (err) {
          console.error('Error checking paused state:', err.message);
        }
      }

      App.bindAdminEvents();
      App.bindVerificationEvents();

    } catch (err) {
      console.error('Initialization error:', err);
    }
  },


  // ── Load Election Metadata from IPFS ─────────────────────
  loadElectionMetadata: async function () {
    try {
      var cid = await App.contractInstance.electionMetadataCID();
      if (cid && cid !== '') {
        var metadata = await fetchFromIPFS(cid);
        var startDate = new Date(metadata.startDate);
        var endDate = new Date(metadata.endDate);
        var dateText = startDate.toDateString() + ' — ' + endDate.toDateString();
        
        // Public UI update
        setText('dates', metadata.electionName ? (metadata.electionName + ' | ' + dateText) : dateText);
        
        var pubTitle = document.querySelector('.hero-section .display-xl');
        if (pubTitle && metadata.electionName && !App.isAdmin) {
          pubTitle.textContent = metadata.electionName;
        }

        // Live Dynamic Countdown & Time-Lock Enforcement (Public Only)
        if (!App.isAdmin) {
          var timerBanner = document.getElementById('election-timer-banner');
          var candidateBox = document.getElementById('boxCandidate');
          var voteArea = document.getElementById('vote');
          if (timerBanner && candidateBox && voteArea) {
            setInterval(function() {
              var now = new Date();
              if (now < startDate) {
                var diff = startDate - now;
                var d = Math.floor(diff / (1000 * 60 * 60 * 24));
                var h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                var m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                var s = Math.floor((diff % (1000 * 60)) / 1000);
                timerBanner.style.display = 'block';
                timerBanner.style.background = '#fef3c7';
                timerBanner.style.color = '#b45309';
                timerBanner.innerHTML = 'Election begins in: <strong>' + d + 'd ' + h + 'h ' + m + 'm ' + s + 's</strong>';
                candidateBox.parentElement.style.display = 'none'; // hide candidate table
                voteArea.style.display = 'none';
              } else if (now > endDate) {
                timerBanner.style.display = 'block';
                timerBanner.style.background = '#ea2261';
                timerBanner.style.color = '#fff';
                timerBanner.innerHTML = 'Ballot Closed';
                voteArea.style.display = 'none';
              } else {
                var diff = endDate - now;
                var d = Math.floor(diff / (1000 * 60 * 60 * 24));
                var h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                var m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                var s = Math.floor((diff % (1000 * 60)) / 1000);
                timerBanner.style.display = 'block';
                timerBanner.style.background = '#e0e7ff';
                timerBanner.style.color = '#533afd';
                timerBanner.innerHTML = 'Election Active — Closes in: <strong>' + d + 'd ' + h + 'h ' + m + 'm ' + s + 's</strong>';
                candidateBox.parentElement.style.display = 'table';
                voteArea.style.display = 'block';
              }
            }, 1000);
          }
        }

        // Admin UI update
        var detailsBox = document.getElementById('election-details-box');
        var wlCid = await App.contractInstance.voterWhitelistCID();
        if (detailsBox) {
          detailsBox.innerHTML = 
            '<tr><td style="font-weight:600; width:30%;">Name</td><td>' + (metadata.electionName || 'Decentralized Election') + '</td></tr>' +
            '<tr><td style="font-weight:600;">Status</td><td><span class="pill-tag-soft" style="background:#4af626; color:#000;">' + (metadata.status || 'Active') + '</span></td></tr>' +
            '<tr><td style="font-weight:600;">Dates</td><td>' + dateText + '</td></tr>' +
            '<tr><td style="font-weight:600;">Whitelist CID</td><td class="tabular">' + 
            (wlCid ? '<span class="hash-mono" onclick="App.copyToClipboard(this, \'' + wlCid + '\')">' + wlCid + '</span>' : 'Not Set') + 
            '</td></tr>';
            
          var exportBtn = document.getElementById('exportManifestBtn');
          if (exportBtn) {
            exportBtn.style.display = 'flex';
            exportBtn.onclick = function() {
              var manifest = {
                electionName: metadata.electionName || 'Decentralized Election',
                startDate: metadata.startDate,
                endDate: metadata.endDate,
                voterWhitelistCID: wlCid,
                smartContractAddress: App.contractInstance.address,
                timestamp: Date.now()
              };
              var blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
              var url = URL.createObjectURL(blob);
              var a = document.createElement('a');
              a.href = url;
              a.download = 'election-manifest-export.json';
              a.click();
              URL.revokeObjectURL(url);
            };
          }
        }

      } else {
        setText('dates', 'Not set yet');
        var detailsBox = document.getElementById('election-details-box');
        if (detailsBox) {
          detailsBox.innerHTML = '<tr><td class="text-mute">No election metadata found on-chain.</td></tr>';
        }
      }
    } catch (err) {
      console.error('Error loading election metadata:', err.message);
      setText('dates', 'Not available');
    }
  },


  // ── Load Candidates (on-chain name/party or IPFS fallback) ─
  loadCandidates: async function () {
    try {
      var count = await App.contractInstance.getCountCandidates();
      var countNum = parseInt(count.toString());
      var boxEl = document.getElementById('boxCandidate');
      if (!boxEl) return;

      // Render Skeleton Shimmers First
      boxEl.innerHTML = '';
      for (var s = 0; s < countNum; s++) {
        boxEl.innerHTML += '<tr>'
          + '<td><div class="shimmer" style="width: 120px; height: 16px;"></div></td>'
          + '<td><div class="shimmer" style="width: 80px; height: 16px;"></div></td>'
          + '</tr>';
      }

      // Fetch all candidate on-chain data
      // getCandidate returns: (id, name, party, ipfsCID, voteCount)
      var candidatesData = [];
      for (var i = 1; i <= countNum; i++) {
        var data = await App.contractInstance.getCandidate(i);
        var id = data[0].toString();
        var name = data[1];
        var party = data[2];
        var ipfsCID = data[3];
        var vCount = parseInt(data[4].toString());

        // If on-chain name is empty, fall back to IPFS CID
        if (!name && ipfsCID) {
          try {
            var ipfsData = await fetchFromIPFS(ipfsCID);
            name = ipfsData.name || ('CID: ' + ipfsCID.substring(0, 12) + '…');
            party = ipfsData.party || 'Unknown';
          } catch (e) {
            console.error('Failed to fetch candidate CID:', ipfsCID, e);
            name = 'CID: ' + ipfsCID.substring(0, 12) + '…';
            party = 'Unknown';
          }
        }

        candidatesData.push({
          id: id,
          name: name || 'Unnamed',
          party: party || '—',
          voteCount: vCount
        });
      }

      // Render Real Data
      boxEl.innerHTML = '';
      for (var i = 0; i < candidatesData.length; i++) {
        var c = candidatesData[i];

        var row = '<tr>'
          + '<td><label class="candidate-radio">'
          + '<input type="radio" name="candidate" value="' + c.id + '" id="candidate-' + c.id + '">'
          + '<span class="radio-mark"></span>' + c.name
          + '</label></td>'
          + '<td>' + c.party + '</td>'
          + '</tr>';

        boxEl.innerHTML += row;
      }
    } catch (err) {
      console.error('Error loading candidates:', err.message);
    }
  },


  // ── Vote ─────────────────────────────────────────────────
  vote: async function () {
    var selected = document.querySelector('input[name="candidate"]:checked');
    if (!selected) {
      setHTML('msg', '<p>Please select a candidate first.</p>');
      return;
    }

    var candidateID = parseInt(selected.value);
    disable('voteButton');
    setHTML('msg', '<p>Submitting vote to blockchain…</p>');

    try {
      var result = await App.contractInstance.vote(candidateID);

      // Build vote receipt and pin to IPFS
      var receipt = {
        _metadata_name: 'dvote-receipt',
        voterAddress: App.account,
        candidateId: candidateID,
        txHash: result.tx,
        blockNumber: result.receipt.blockNumber,
        timestamp: new Date().toISOString()
      };

      setHTML('msg', '<p>Vote confirmed! Pinning receipt to IPFS…</p>');

      var receiptCID = await uploadToIPFS(receipt);
      var gatewayLink = PINATA_GATEWAY + '/' + receiptCID;

      // Show receipt
      var receiptArea = document.getElementById('receipt-area');
      if (receiptArea) {
        receiptArea.style.display = 'block';
        receiptArea.innerHTML =
          '<div class="card-feature-light animate-in" style="margin-top:var(--space-xl)">'
          + '<h3 class="heading-sm mb-lg" style="color:var(--color-primary)">✓ Vote Receipt</h3>'
          + '<p class="body-sm">Your vote has been permanently recorded.</p>'
          + '<div style="margin-top:var(--space-md);padding:var(--space-md);background:var(--color-canvas-soft);border-radius:var(--rounded-md);word-break:break-all">'
          + '<p class="caption"><strong>Tx Hash:</strong> <span class="hash-mono" onclick="App.copyToClipboard(this, \'' + result.tx + '\')">' + result.tx + '</span></p>'
          + '<p class="caption" style="margin-top:var(--space-xs)"><strong>IPFS Receipt:</strong> '
          + '<span class="hash-mono" onclick="App.copyToClipboard(this, \'' + receiptCID + '\')">' + receiptCID + '</span> '
          + '<a href="' + gatewayLink + '" target="_blank" rel="noopener" style="color:var(--color-primary); font-size:10px; margin-left: 8px;">(View on IPFS)</a></p>'
          + '</div>'
          + '</div>';
      }

      setHTML('msg', '<p style="color:var(--color-primary);font-weight:500">✓ Voted successfully!</p>');

      // Reload candidates to update counts
      await App.loadCandidates();

    } catch (err) {
      console.error('Vote error:', err);
      if (err.code === 4001 || (err.message && err.message.includes('User denied transaction'))) {
        setHTML('msg', '<p style="color:var(--color-ruby)">Transaction cancelled by user</p>');
      } else {
        setHTML('msg', '<p style="color:var(--color-ruby)">Vote failed: ' + (err.message || err) + '</p>');
      }
      enable('voteButton');
    }
  },


  // ── Logger & Utilities ───────────────────────────────────
  logSystem: function (msg) {
    var logger = document.getElementById('system-logger');
    if (logger) {
      var timestamp = new Date().toLocaleTimeString();
      var formattedMsg = msg
        .replace(/(0x[a-fA-F0-9]{40})/g, '<span class="hash-mono" onclick="App.copyToClipboard(this, \'$1\')">$1</span>')
        .replace(/(0x[a-fA-F0-9]{64})/g, '<span class="hash-mono" onclick="App.copyToClipboard(this, \'$1\')">$1</span>') // tx hashes
        .replace(/(Qm[a-zA-Z0-9]{44})/g, '<span class="hash-mono" onclick="App.copyToClipboard(this, \'$1\')">$1</span>');
      
      logger.innerHTML += '\n[' + timestamp + '] [SYSTEM]: ' + formattedMsg;
      logger.scrollTop = logger.scrollHeight;
    }
  },

  copyToClipboard: function(element, text) {
    var fallbackCopy = function(text) {
      var textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try { document.execCommand('copy'); } catch(err) {}
      document.body.removeChild(textArea);
    };

    var successUI = function() {
      var origText = element.textContent;
      element.textContent = 'Copied!';
      element.style.color = '#4af626';
      element.style.opacity = '1';
      element.style.textDecoration = 'none';
      setTimeout(function() {
        element.textContent = origText;
        element.style.color = '';
      }, 2000);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(successUI).catch(function() {
        fallbackCopy(text);
        successUI();
      });
    } else {
      fallbackCopy(text);
      successUI();
    }
  },

  // ── Pending Queue ────────────────────────────────────────
  loadPendingQueue: async function () {
    try {
      var response = await fetch('/api/ipfs/queue-candidate');
      var data = await response.json();
      var queue = data.queue || [];
      var tbody = document.getElementById('pendingCandidatesBox');
      var status = document.getElementById('queueStatus');
      
      if (!tbody) return;

      if (queue.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-mute" style="text-align:center;">No pending candidates.</td></tr>';
        if(status) status.style.display = 'none';
        return;
      }

      tbody.innerHTML = '';
      queue.forEach(function(c) {
        var tr = document.createElement('tr');
        
        var tdName = document.createElement('td');
        tdName.textContent = c.name;
        
        var tdParty = document.createElement('td');
        tdParty.textContent = c.party;

        var tdAction = document.createElement('td');
        var btn = document.createElement('button');
        btn.className = 'btn-primary-pill';
        btn.style.padding = '4px 12px';
        btn.textContent = 'Approve';
        btn.onclick = async function() {
          btn.disabled = true;
          btn.textContent = 'Approving...';
          try {
            App.logSystem('Approving candidate: ' + c.name);
            var cid = await uploadToIPFS({
              _metadata_name: 'dvote-candidate',
              name: c.name,
              party: c.party
            });
            App.logSystem('Pinned ' + c.name + ' to IPFS. CID: ' + cid);
            
            await App.contractInstance.addCandidate(cid);
            App.logSystem('Candidate ' + c.name + ' added to blockchain ledger.');

            // Remove from queue
            await fetch('/api/ipfs/queue-approve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tempId: c.tempId })
            });

            App.loadPendingQueue();
            if (typeof App.loadCandidates === 'function') App.loadCandidates();

          } catch (err) {
            console.error('Approve error:', err);
            if (err.code === 4001 || (err.message && err.message.includes('User denied transaction'))) {
              App.logSystem('Transaction cancelled by user for candidate: ' + c.name);
            } else {
              App.logSystem('Error approving candidate: ' + err.message);
            }
            btn.disabled = false;
            btn.textContent = 'Approve';
          }
        };
        tdAction.appendChild(btn);

        tr.appendChild(tdName);
        tr.appendChild(tdParty);
        tr.appendChild(tdAction);
        tbody.appendChild(tr);
      });
      if(status) status.style.display = 'none';

    } catch (err) {
      console.error('Failed to load queue:', err);
      var status = document.getElementById('queueStatus');
      if (status) {
        status.textContent = 'Failed to load queue.';
        status.style.display = 'block';
      }
    }
  },

  // ── Admin Live Analytics ─────────────────────────────────
  loadAdminAnalytics: async function () {
    var barCtx = document.getElementById('barChart');
    var pieCtx = document.getElementById('doughnutChart');
    if (!barCtx || !pieCtx) return;

    try {
      var count = await App.contractInstance.getCountCandidates();
      var countNum = parseInt(count.toString());
      var candidatesData = [];
      var partyVotes = {};

      for (var i = 1; i <= countNum; i++) {
        var data = await App.contractInstance.getCandidate(i);
        // getCandidate returns: (id, name, party, ipfsCID, voteCount)
        var cName = data[1];
        var cParty = data[2];
        var ipfsCID = data[3];
        var vCount = parseInt(data[4].toString());

        // Fall back to IPFS if on-chain name is empty (legacy candidate)
        if (!cName && ipfsCID) {
          try {
            var ipfsData = await fetchFromIPFS(ipfsCID);
            cName = ipfsData.name || 'Unknown';
            cParty = ipfsData.party || 'Unknown';
          } catch (e) {
            console.error('Failed to fetch candidate CID for analytics:', ipfsCID);
            cName = 'CID ' + ipfsCID.substring(0, 8);
            cParty = 'Unknown';
          }
        }

        candidatesData.push({
          name: cName || 'Unnamed',
          votes: vCount
        });

        // Reducer for Doughnut Chart
        var partyKey = cParty || 'Unknown';
        if (!partyVotes[partyKey]) {
          partyVotes[partyKey] = 0;
        }
        partyVotes[partyKey] += vCount;
      }

      // Render Bar Chart
      new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: candidatesData.map(c => c.name),
          datasets: [{
            label: 'Total Votes',
            data: candidatesData.map(c => c.votes),
            backgroundColor: '#533afd',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } }
          }
        }
      });

      // Render Doughnut Chart
      var partyLabels = Object.keys(partyVotes);
      var partyData = Object.values(partyVotes);
      var gradientColors = ['#533afd', '#ea2261', '#ff9800', '#4af626', '#00bcd4', '#9c27b0'];
      
      new Chart(pieCtx, {
        type: 'doughnut',
        data: {
          labels: partyLabels,
          datasets: [{
            data: partyData,
            backgroundColor: gradientColors.slice(0, partyLabels.length),
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' }
          }
        }
      });

    } catch (err) {
      console.error('Failed to load admin analytics:', err);
    }
  },

  // ── Admin Event Bindings ─────────────────────────────────
  bindAdminEvents: function () {
    
    // Initialize Faux Logger & Queue & Analytics
    App.logSystem('Admin dashboard modules loaded.');
    App.loadPendingQueue();
    App.loadAdminAnalytics();

    // ── Circuit Breaker ────────────────────────────────────
    var pauseBtn = document.getElementById('togglePauseBtn');
    if (pauseBtn) {
      // Check initial state
      App.contractInstance.paused().then(function(isPaused) {
        if (isPaused) {
          pauseBtn.innerHTML = 'Resume Election';
          pauseBtn.style.backgroundColor = '#4af626';
          pauseBtn.style.color = '#000';
        }
      });

      pauseBtn.addEventListener('click', async function () {
        var statusEl = document.getElementById('pauseStatus');
        pauseBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'Broadcasting transaction...';
        try {
          var isPaused = await App.contractInstance.paused();
          App.logSystem('Broadcasting ' + (isPaused ? 'Resume' : 'Halt') + ' Election signal...');
          
          await App.contractInstance.togglePause();
          
          isPaused = await App.contractInstance.paused();
          App.logSystem('Circuit breaker toggled. Current state: ' + (isPaused ? 'PAUSED' : 'ACTIVE'));
          
          if (isPaused) {
            pauseBtn.innerHTML = 'Resume Election';
            pauseBtn.style.backgroundColor = '#4af626';
            pauseBtn.style.color = '#000';
            if (statusEl) statusEl.textContent = 'Election Halted';
          } else {
            pauseBtn.innerHTML = 'Halt Election';
            pauseBtn.style.backgroundColor = '#ea2261';
            pauseBtn.style.color = '#fff';
            if (statusEl) statusEl.textContent = 'Election Resumed';
          }
        } catch (err) {
          console.error('Toggle pause error:', err);
          if (statusEl) statusEl.textContent = 'Error: ' + err.message;
          App.logSystem('Circuit breaker error: ' + err.message);
        }
        pauseBtn.disabled = false;
      });
    }

    // ── Dynamic Candidate Roster Rows ──────────────────────
    var addRowBtn = document.getElementById('addCandidateRow');
    if (addRowBtn) {
      addRowBtn.addEventListener('click', function () {
        var roster = document.getElementById('candidate-roster');
        if (!roster) return;

        var row = document.createElement('div');
        row.className = 'candidate-row admin-form-grid';
        row.style.cssText = 'margin-bottom: var(--space-sm); align-items: flex-end;';
        row.innerHTML =
          '<div class="form-group" style="margin-bottom:0;">'
          + '<label class="form-label">&nbsp;</label>'
          + '<input type="text" class="text-input candidate-name" placeholder="Full name" autocomplete="off">'
          + '</div>'
          + '<div class="form-group" style="margin-bottom:0;">'
          + '<label class="form-label">&nbsp;</label>'
          + '<input type="text" class="text-input candidate-party" placeholder="Party affiliation">'
          + '</div>'
          + '<div style="flex: 0 0 36px;">'
          + '<button type="button" style="background:none; border:none; color:#ea2261; cursor:pointer; font-size:18px; font-weight:bold; padding:8px;" onclick="this.closest(\'.candidate-row\').remove()">✕</button>'
          + '</div>';
        roster.appendChild(row);
      });
    }

    // ── Deploy Election State (Atomic) ────────────────────
    var deployBtn = document.getElementById('deployElectionBtn');
    if (deployBtn) {
      deployBtn.addEventListener('click', async function () {
        var statusEl = document.getElementById('deploy-status');
        var electionName = getVal('election-name').trim();
        var startDate = getVal('startDate');
        var endDate = getVal('endDate');

        // Collect candidates from the dynamic roster
        var nameInputs = document.querySelectorAll('#candidate-roster .candidate-name');
        var partyInputs = document.querySelectorAll('#candidate-roster .candidate-party');
        var candidateNames = [];
        var candidateParties = [];

        for (var i = 0; i < nameInputs.length; i++) {
          var n = nameInputs[i].value.trim();
          var p = partyInputs[i].value.trim();
          if (n && p) {
            candidateNames.push(n);
            candidateParties.push(p);
          }
        }

        // Validation
        if (!electionName || !startDate || !endDate) {
          if (statusEl) statusEl.textContent = 'Please fill in Election Name, Start, and End dates.';
          return;
        }
        if (candidateNames.length === 0) {
          if (statusEl) statusEl.textContent = 'Please add at least one candidate with both Name and Party.';
          return;
        }

        deployBtn.disabled = true;

        try {
          // Step 1: Upload metadata to IPFS
          if (statusEl) statusEl.textContent = 'Uploading election metadata to IPFS…';
          App.logSystem('Deploying election: "' + electionName + '" with ' + candidateNames.length + ' candidate(s).');

          var metadataCID = await uploadToIPFS({
            _metadata_name: 'dvote-election-metadata',
            electionName: electionName,
            startDate: startDate,
            endDate: endDate,
            candidates: candidateNames.map(function(n, idx) {
              return { name: n, party: candidateParties[idx] };
            }),
            timestamp: Date.now(),
            status: 'Active'
          });

          App.logSystem('Metadata pinned to IPFS. CID: ' + metadataCID);

          // Step 2: Atomic blockchain transaction
          if (statusEl) statusEl.textContent = 'Broadcasting atomic initializeElection transaction…';
          App.logSystem('Calling initializeElection on-chain…');

          await App.contractInstance.initializeElection(
            metadataCID,
            candidateNames,
            candidateParties,
            { from: App.account }
          );

          App.logSystem('Election deployed successfully on-chain.');
          if (statusEl) statusEl.textContent = '✓ Election deployed! (' + candidateNames.length + ' candidates on-chain)';

          // Step 3: Clear the form
          document.getElementById('election-name').value = '';
          document.getElementById('startDate').value = '';
          document.getElementById('endDate').value = '';
          var roster = document.getElementById('candidate-roster');
          if (roster) {
            // Keep only first row, clear its inputs
            var rows = roster.querySelectorAll('.candidate-row');
            for (var r = 1; r < rows.length; r++) { rows[r].remove(); }
            var firstRow = rows[0];
            if (firstRow) {
              firstRow.querySelector('.candidate-name').value = '';
              firstRow.querySelector('.candidate-party').value = '';
            }
          }

          // Step 4: Refresh UI
          await App.loadElectionMetadata();
          await App.loadCandidates();
          App.loadAdminAnalytics();

        } catch (err) {
          console.error('Deploy election error:', err);
          App.logSystem('Deploy election error: ' + err.message);
          if (err.code === 4001 || (err.message && err.message.includes('User denied transaction'))) {
            if (statusEl) statusEl.textContent = 'Transaction cancelled by user';
          } else {
            if (statusEl) statusEl.textContent = 'Error: ' + (err.message || err);
          }
        }

        deployBtn.disabled = false;
      });
    }


    // ── Set Voter Whitelist ────────────────────────────────
    var setWhitelistBtn = document.getElementById('setWhitelist');
    if (setWhitelistBtn) {
      setWhitelistBtn.addEventListener('click', async function () {
        var textarea = document.getElementById('whitelistData');
        var statusEl = document.getElementById('whitelist-status');

        if (!textarea || !textarea.value.trim()) {
          if (statusEl) statusEl.textContent = 'Please enter voter whitelist JSON.';
          return;
        }

        setWhitelistBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'Validating JSON…';

        try {
          var parsed = JSON.parse(textarea.value.trim());

          // Ensure it has a voters array
          if (!parsed.voters || !Array.isArray(parsed.voters)) {
            throw new Error('JSON must contain a "voters" array');
          }

          if (statusEl) statusEl.textContent = 'Uploading whitelist to IPFS…';

          var cid = await uploadToIPFS({
            _metadata_name: 'dvote-voter-whitelist',
            voters: parsed.voters
          });

          if (statusEl) statusEl.textContent = 'Pinned! Saving CID on-chain…';

          await App.contractInstance.setVoterWhitelist(cid);

          if (statusEl) statusEl.textContent = '✓ Whitelist set (' + parsed.voters.length + ' voters, CID: ' + cid.substring(0, 16) + '…)';

        } catch (err) {
          console.error('Whitelist error:', err);
          if (statusEl) statusEl.textContent = 'Error: ' + (err.message || err);
        }

        setWhitelistBtn.disabled = false;
      });
    }
  },

  // ── Verification Event Bindings ──────────────────────────
  bindVerificationEvents: function() {
    var verifyBtn = document.getElementById('verifyReceiptBtn');
    if (verifyBtn) {
      verifyBtn.addEventListener('click', async function() {
        var cidInput = document.getElementById('receipt-cid-input');
        var errorDiv = document.getElementById('audit-error');
        var resultDiv = document.getElementById('audit-result');
        
        var cid = cidInput ? cidInput.value.trim() : '';
        if (!cid) {
          if (errorDiv) {
            errorDiv.textContent = 'Please enter a valid IPFS CID.';
            errorDiv.style.display = 'block';
          }
          if (resultDiv) resultDiv.style.display = 'none';
          return;
        }

        verifyBtn.disabled = true;
        if (errorDiv) errorDiv.style.display = 'none';
        if (resultDiv) resultDiv.style.display = 'none';

        try {
          // Fetch from IPFS
          var receipt = await fetchFromIPFS(cid);
          
          var txHash = receipt.txHash || receipt.blockchainTransactionHash;
          var electionId = receipt.candidateId || (receipt.auditTrails ? receipt.auditTrails.voterElectionId : 'N/A');

          if (!txHash) {
             throw new Error("Invalid receipt format on IPFS: Missing transaction hash.");
          }

          // Verify against Ganache
          var txReceipt = await window.eth.eth.getTransactionReceipt(txHash);
          
          if (!txReceipt) {
            throw new Error("Transaction not found on the blockchain ledger.");
          }

          // Populate UI
          setText('audit-election-id', electionId);
          setText('audit-wallet', txReceipt.from);
          setText('audit-block', txReceipt.blockNumber);
          if (resultDiv) resultDiv.style.display = 'block';

        } catch (err) {
          console.error('Receipt verify error:', err);
          if (errorDiv) {
            errorDiv.textContent = 'Error: ' + err.message;
            errorDiv.style.display = 'block';
          }
        }
        verifyBtn.disabled = false;
      });
    }

    var fetchWhitelistBtn = document.getElementById('fetchWhitelistBtn');
    if (fetchWhitelistBtn) {
      fetchWhitelistBtn.addEventListener('click', async function() {
        var cidInput = document.getElementById('whitelist-cid-input');
        var errorDiv = document.getElementById('whitelist-error');
        var resultPre = document.getElementById('whitelist-result');

        var cid = cidInput ? cidInput.value.trim() : '';
        if (!cid) {
          if (errorDiv) {
            errorDiv.textContent = 'Please enter a valid Whitelist CID.';
            errorDiv.style.display = 'block';
          }
          if (resultPre) resultPre.style.display = 'none';
          return;
        }

        fetchWhitelistBtn.disabled = true;
        if (errorDiv) errorDiv.style.display = 'none';
        if (resultPre) resultPre.style.display = 'none';
        
        try {
          var data = await fetchFromIPFS(cid);
          
          if (resultPre) {
            resultPre.textContent = JSON.stringify(data, null, 2);
            resultPre.style.display = 'block';
          }
        } catch (err) {
          console.error('Whitelist fetch error:', err);
          if (errorDiv) {
            errorDiv.textContent = 'Error: Could not retrieve whitelist. Ensure the CID is correct and pinned to IPFS.';
            errorDiv.style.display = 'block';
          }
        }
        
        fetchWhitelistBtn.disabled = false;
      });
    }
  }
};


// ── Boot ────────────────────────────────────────────────────
window.addEventListener('load', function () {
  if (typeof window.ethereum !== 'undefined') {
    console.log('Using MetaMask / injected Web3 provider');
    window.eth = new Web3(window.ethereum);
  } else {
    console.warn('No MetaMask detected. Falling back to Ganache at http://127.0.0.1:7545');
    window.eth = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:7545'));
  }
  window.App.eventStart();
});

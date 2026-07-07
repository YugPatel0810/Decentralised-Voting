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
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch from IPFS: ' + cid);
  return response.json();
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
    try {
      // Connect Web3
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

      // Load contract
      var VotingContract = contract(votingArtifacts);
      VotingContract.setProvider(web3Instance.currentProvider);
      VotingContract.defaults({ from: App.account, gas: 6654755 });

      var instance = await VotingContract.deployed();
      App.contractInstance = instance;

      // Check admin status
      var adminAddress = await instance.admin();
      App.isAdmin = (App.account.toLowerCase() === adminAddress.toLowerCase());

      // Display account
      setText('accountAddress', 'Your Account: ' + App.account);

      // Admin guard for admin page
      var isAdminPage = !!document.getElementById('addCandidate');
      if (isAdminPage) {
        if (!App.isAdmin) {
          document.body.innerHTML = '<div style="text-align:center;padding:100px"><h1>Access Denied</h1><p>You must connect with the admin wallet.</p><a href="/">← Back to Login</a></div>';
          return;
        }
      }

      // Load page-specific data
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

      // Bind admin events
      App.bindAdminEvents();
      
      // Bind verification events
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


  // ── Load Candidates from IPFS ────────────────────────────
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
      var candidatesData = [];
      var totalVotes = 0;
      for (var i = 1; i <= countNum; i++) {
        var data = await App.contractInstance.getCandidate(i);
        var vCount = parseInt(data[2].toString());
        totalVotes += vCount;
        candidatesData.push({
          id: data[0].toString(),
          ipfsCID: data[1],
          voteCount: vCount
        });
      }

      // Render Real Data
      boxEl.innerHTML = '';
      for (var i = 0; i < candidatesData.length; i++) {
        var c = candidatesData[i];
        
        var candidateInfo = { name: 'Loading…', party: '—' };
        try {
          candidateInfo = await fetchFromIPFS(c.ipfsCID);
        } catch (e) {
          console.error('Failed to fetch candidate CID:', c.ipfsCID, e);
          candidateInfo = { name: 'CID: ' + c.ipfsCID.substring(0, 12) + '…', party: 'Unknown' };
        }

        var row = '<tr>'
          + '<td><label class="candidate-radio">'
          + '<input type="radio" name="candidate" value="' + c.id + '" id="candidate-' + c.id + '">'
          + '<span class="radio-mark"></span>' + candidateInfo.name
          + '</label></td>'
          + '<td>' + candidateInfo.party + '</td>'
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
      setHTML('msg', '<p style="color:var(--color-ruby)">Vote failed: ' + (err.message || err) + '</p>');
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
            App.logSystem('Error approving candidate: ' + err.message);
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
        var vCount = parseInt(data[2].toString());
        var ipfsCID = data[1];

        var candidateInfo = { name: 'CID ' + ipfsCID.substring(0, 8), party: 'Unknown' };
        try {
          candidateInfo = await fetchFromIPFS(ipfsCID);
        } catch (e) {
          console.error('Failed to fetch candidate CID for analytics:', ipfsCID);
        }

        candidatesData.push({
          name: candidateInfo.name,
          votes: vCount
        });

        // Reducer for Doughnut Chart
        if (!partyVotes[candidateInfo.party]) {
          partyVotes[candidateInfo.party] = 0;
        }
        partyVotes[candidateInfo.party] += vCount;
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

    // ── Add Candidate ──────────────────────────────────────
    var addCandidateBtn = document.getElementById('addCandidate');
    if (addCandidateBtn) {
      addCandidateBtn.addEventListener('click', async function () {
        var name = getVal('name').trim();
        var party = getVal('party').trim();
        var statusEl = document.getElementById('Aday');

        if (!name || !party) {
          if (statusEl) statusEl.textContent = 'Please fill in both fields.';
          return;
        }

        addCandidateBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'Uploading to IPFS…';

        try {
          // 1. Upload candidate data to IPFS
          var cid = await uploadToIPFS({
            _metadata_name: 'dvote-candidate',
            name: name,
            party: party
          });

          if (statusEl) statusEl.textContent = 'Pinned! Saving CID on-chain…';

          // 2. Store CID on blockchain
          await App.contractInstance.addCandidate(cid);

          if (statusEl) statusEl.textContent = '✓ Candidate added (CID: ' + cid.substring(0, 16) + '…)';
          document.getElementById('name').value = '';
          document.getElementById('party').value = '';

          // Refresh candidate list if visible
          await App.loadCandidates();

        } catch (err) {
          console.error('Add candidate error:', err);
          if (statusEl) statusEl.textContent = 'Error: ' + (err.message || err);
        }

        addCandidateBtn.disabled = false;
      });
    }


    // ── Set Election Metadata ──────────────────────────────
    var addDateBtn = document.getElementById('addDate');
    if (addDateBtn) {
      addDateBtn.addEventListener('click', async function () {
        var electionName = getVal('election-name');
        var startDate = getVal('startDate');
        var endDate = getVal('endDate');
        var statusEl = addDateBtn.parentElement.querySelector('.status-message');

        if (!electionName || !startDate || !endDate) {
          if (statusEl) statusEl.textContent = 'Please fill in all fields (Name, Start, End).';
          return;
        }

        addDateBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'Uploading metadata to IPFS…';

        try {
          var cid = await uploadToIPFS({
            _metadata_name: 'dvote-election-metadata',
            electionName: electionName,
            startDate: startDate,
            endDate: endDate,
            timestamp: Date.now(),
            status: "Active"
          });

          if (statusEl) statusEl.textContent = 'Pinned! Saving CID on-chain…';

          await App.contractInstance.setElectionMetadata(cid);

          if (statusEl) statusEl.textContent = '✓ Election dates set (CID: ' + cid.substring(0, 16) + '…)';

        } catch (err) {
          console.error('Set dates error:', err);
          if (statusEl) statusEl.textContent = 'Error: ' + (err.message || err);
        }

        addDateBtn.disabled = false;
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
          
          resultDiv.style.display = 'block';

        } catch (err) {
          console.error("Verification error:", err);
          if (errorDiv) {
             errorDiv.textContent = 'Verification failed: ' + (err.message || err);
             errorDiv.style.display = 'block';
          }
        }
        verifyBtn.disabled = false;
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Voting {

    // ── Admin ────────────────────────────────────────────────
    address public admin;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this");
        _;
    }

    // ── Candidate ────────────────────────────────────────────
    struct Candidate {
        uint   id;
        string name;
        string party;
        string ipfsCID;      // used by Pending Queue approval path
        uint   voteCount;
    }

    mapping(uint => Candidate) public candidates;
    uint public countCandidates;

    // ── Election metadata CID ────────────────────────────────
    string public electionMetadataCID;

    // ── Voter whitelist CID ──────────────────────────────────
    string public voterWhitelistCID;

    // ── Voter tracking ───────────────────────────────────────
    mapping(address => bool) public voters;

    // ── Events ───────────────────────────────────────────────
    event CandidateAdded(uint indexed id, string name);
    event VoteCast(address indexed voter, uint indexed candidateId);
    event ElectionMetadataSet(string cid);
    event VoterWhitelistSet(string cid);
    event ElectionInitialized(string metadataCID, uint candidateCount);
    event ElectionPaused(bool isPaused);

    // ── Constructor ──────────────────────────────────────────
    constructor() {
        admin = msg.sender;
    }

    // ── Atomic Election Initialization ───────────────────────
    function initializeElection(
        string memory _metadataCID,
        string[] memory _candidateNames,
        string[] memory _candidateParties
    ) public onlyAdmin {
        require(_candidateNames.length == _candidateParties.length, "Names and parties length mismatch");
        require(_candidateNames.length > 0, "Must have at least one candidate");

        // Reset state
        countCandidates = 0;

        // Set metadata
        electionMetadataCID = _metadataCID;

        // Add all candidates atomically
        for (uint i = 0; i < _candidateNames.length; i++) {
            countCandidates++;
            candidates[countCandidates] = Candidate(
                countCandidates,
                _candidateNames[i],
                _candidateParties[i],
                "",            // no IPFS CID for directly initialized candidates
                0
            );
            emit CandidateAdded(countCandidates, _candidateNames[i]);
        }

        emit ElectionInitialized(_metadataCID, countCandidates);
    }

    // ── Legacy: Add single candidate via IPFS CID (Pending Queue) ─
    function addCandidate(string memory _ipfsCID) public onlyAdmin returns (uint) {
        countCandidates++;
        candidates[countCandidates] = Candidate(countCandidates, "", "", _ipfsCID, 0);
        emit CandidateAdded(countCandidates, _ipfsCID);
        return countCandidates;
    }

    function getCandidate(uint _id) public view returns (
        uint, string memory, string memory, string memory, uint
    ) {
        Candidate memory c = candidates[_id];
        return (c.id, c.name, c.party, c.ipfsCID, c.voteCount);
    }

    function getCountCandidates() public view returns (uint) {
        return countCandidates;
    }

    // ── Reset Election ───────────────────────────────────────
    function resetElectionState() public onlyAdmin {
        countCandidates = 0;
    }

    // ── Circuit Breaker ──────────────────────────────────────
    bool public paused = false;

    function togglePause() public onlyAdmin {
        paused = !paused;
        emit ElectionPaused(paused);
    }

    // ── Voting ───────────────────────────────────────────────
    function vote(uint _candidateId) public {
        require(!paused, "Voting is temporarily suspended");
        require(_candidateId > 0 && _candidateId <= countCandidates, "Invalid candidate ID");
        require(!voters[msg.sender], "You have already voted");

        voters[msg.sender] = true;
        candidates[_candidateId].voteCount++;

        emit VoteCast(msg.sender, _candidateId);
    }

    function checkVote() public view returns (bool) {
        return voters[msg.sender];
    }

    // ── Election metadata ────────────────────────────────────
    function setElectionMetadata(string memory _cid) public onlyAdmin {
        electionMetadataCID = _cid;
        emit ElectionMetadataSet(_cid);
    }

    // ── Voter whitelist ──────────────────────────────────────
    function setVoterWhitelist(string memory _cid) public onlyAdmin {
        voterWhitelistCID = _cid;
        emit VoterWhitelistSet(_cid);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Voting {

    // ── Admin ────────────────────────────────────────────────
    address public admin;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this");
        _;
    }

    // ── Candidate (IPFS-backed) ──────────────────────────────
    struct Candidate {
        uint   id;
        string ipfsCID;      // points to JSON {"name":"...","party":"..."}
        uint   voteCount;
    }

    mapping(uint => Candidate) public candidates;
    uint public countCandidates;

    // ── Election metadata CID ────────────────────────────────
    // Points to JSON {"startDate":"...","endDate":"...","name":"..."}
    string public electionMetadataCID;

    // ── Voter whitelist CID ──────────────────────────────────
    // Points to JSON {"voters":["id1","id2",...]}
    string public voterWhitelistCID;

    // ── Voter tracking ───────────────────────────────────────
    mapping(address => bool) public voters;

    // ── Events ───────────────────────────────────────────────
    event CandidateAdded(uint indexed id, string ipfsCID);
    event VoteCast(address indexed voter, uint indexed candidateId);
    event ElectionMetadataSet(string cid);
    event VoterWhitelistSet(string cid);

    // ── Constructor ──────────────────────────────────────────
    constructor() {
        admin = msg.sender;
    }

    // ── Candidate management ─────────────────────────────────
    function addCandidate(string memory _ipfsCID) public onlyAdmin returns (uint) {
        countCandidates++;
        candidates[countCandidates] = Candidate(countCandidates, _ipfsCID, 0);
        emit CandidateAdded(countCandidates, _ipfsCID);
        return countCandidates;
    }

    function getCandidate(uint _id) public view returns (uint, string memory, uint) {
        Candidate memory c = candidates[_id];
        return (c.id, c.ipfsCID, c.voteCount);
    }

    function getCountCandidates() public view returns (uint) {
        return countCandidates;
    }

    // ── Circuit Breaker ──────────────────────────────────────
    bool public paused = false;

    event ElectionPaused(bool isPaused);

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

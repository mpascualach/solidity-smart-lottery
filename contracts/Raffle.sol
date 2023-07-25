// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AutomationCompatibleInterface.sol";
import "hardhat/console.sol";

error Raffle__UpkeepNotNeeded(
    uint256 currentBalance,
    uint256 numPlayers,
    uint256 raffleState
);
error Raffle__TransferFailed();
error Raffle__SendMoreToEnterRaffle();
error Raffle__RaffleNotOpen();

contract Raffle is VRFConsumerBaseV2, AutomationCompatibleInterface {
    /* Type declarations */
    enum RaffleState {
        OPEN,
        CALCULATING
    }
    /* State variables */
    // Chainlink VRF Variables

    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    uint64 private immutable i_subscriptionId;
    bytes32 private immutable i_gasLane;
    uint32 private immutable i_callbackGasLimit;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private constant NUM_WORDS = 1;

    uint256 private immutable i_interval;
    uint256 private immutable i_entranceFee;
    uint256 private s_lastTimeStamp;
    address private s_recentWinner;
    address payable[] private s_players;
    RaffleState private s_raffleState;

    event RequestRaffleWinner(uint256 indexed requestId);
    event RaffleEnter(address indexed player);
    event WinnerPicked(address indexed player);

    constructor(
        address vrfCoordinatorV2,
        uint64 subscriptionId,
        bytes32 gasLane,
        uint256 interval,
        uint256 entranceFee,
        uint32 callbackGasLimit
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_gasLane = gasLane;
        i_interval = interval;
        i_subscriptionId = subscriptionId;
        i_entranceFee = entranceFee;
        s_raffleState = RaffleState.OPEN;
        s_lastTimeStamp = block.timestamp;
        i_callbackGasLimit = callbackGasLimit;
    }

    /**
     * @dev The function that Chainlink Keeper nodes call
     * they look for `upkeepNeeded` returning False
     * the following should be true if it is to return true:
     * 1. Enough time has passed between raffle runs
     * 2. The lottery is open.
     * 3. The contract has enough ETH
     * 4. Your subscription is funded with LINK
     *
     */

    function checkUpkeep(
        bytes memory /* checkData */
    )
        public
        view
        override
        returns (bool upkeepNeeded, bytes memory /* performData */)
    {
        bool isOpen = RaffleState.OPEN == s_raffleState;
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_interval);
        bool hasPlayers = s_players.length > 0;
        bool hasBalance = address(this).balance > 0;
        upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers);
        // return (isOpen && timePassed && hasPlayers && hasBalance);
    }

    /**
     * @dev Once `checkUpkeep` returns `true`, this function is triggered
     * and it kicks off a Chainlink VRF call to select a random winner.
     */

    function performUpkeep(bytes calldata /* performData */) external override {
        (bool upkeepNeeded, ) = checkUpkeep("");
        // require(upkeepNeeded, "Upkeep not needed")
        if (!upkeepNeeded) {
            revert Raffle__UpkeepNotNeeded(
                address(this).balance,
                s_players.length,
                uint256(s_raffleState)
            );
        }
        s_raffleState = RaffleState.CALCULATING;
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );
        // the below event is redundant because requestRandomWords already emits an event of this kind
        emit RequestRaffleWinner(requestId);
    }

    function enterRaffle() public payable {
        // require(msg.value >= i_entranceFee, "Not enough value sent");
        // require(s_raffleState == RaffleState.OPEN, "Raffle is not open");
        if (msg.value < i_entranceFee) {
            // if not enough ETH Has been sent
            revert Raffle__SendMoreToEnterRaffle();
        }
        if (s_raffleState != RaffleState.OPEN) {
            // if raffle isn't open yet
            revert Raffle__RaffleNotOpen();
        }
        s_players.push(payable(msg.sender)); // push current user into array of raffle participants
        emit RaffleEnter(msg.sender); // emit event suggesting someone has entered the raffle
    }

    function fulfillRandomWords(
        uint256 /* requestId */,
        uint256[] memory randomWords
    ) internal override {
        /* select random winner */
        uint256 indexOfWinner = randomWords[0] % s_players.length; // select random number
        address payable recentWinner = s_players[indexOfWinner]; // select winner from players array (with index equal to indexOfWinner)
        s_recentWinner = recentWinner; // announce winner
        s_players = new address payable[](0); // clear players array
        s_raffleState = RaffleState.OPEN; // reopen raffle
        s_lastTimeStamp = block.timestamp; // set lastTimeStamp to current timeStamp
        (bool success, ) = recentWinner.call{value: address(this).balance}("");
        // require(success, "Transfer failed");
        if (!success) {
            revert Raffle__TransferFailed();
        }
        emit WinnerPicked(recentWinner);
    }

    function getNumWords() public pure returns (uint256) {
        return NUM_WORDS;
    }

    function getRequestConfirmations() public pure returns (uint256) {
        return REQUEST_CONFIRMATIONS;
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getPlayer(uint256 index) public view returns (address) {
        return s_players[index];
    }

    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState;
    }

    function getLastTimeStamp() public view returns (uint256) {
        return s_lastTimeStamp;
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return s_players.length;
    }
}

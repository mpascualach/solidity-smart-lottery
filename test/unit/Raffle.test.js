const { assert, expect } = require("chai");
const { network, deployments, ethers } = require("hardhat");
const {
  developmentChains,
  networkConfig,
} = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Raffle Unit Tests", function () {
      let raffle,
        raffleContract,
        vrfCoordinatorV2Mock,
        raffleEntranceFee,
        interval,
        player; // , deployer

      beforeEach(async () => {
        accounts = await ethers.getSigners(); // could also do with getNamedAccounts
        //   deployer = accounts[0]
        player = accounts[1];
        await deployments.fixture(["mocks", "raffle"]); // Deploys modules with the tags "mocks" and "raffle"
        vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock"); // Returns a new connection to the VRFCoordinatorV2Mock contract
        raffleContract = await ethers.getContract("Raffle"); // Returns a new connection to the Raffle contract
        raffle = raffleContract.connect(player); // Returns a new instance of the Raffle contract connected to player
        raffleEntranceFee = await raffle.getEntranceFee();
        interval = await raffle.getInterval();
      });

      describe("constructor", function () {
        it("initializes the raffle correctly", async () => {
          // Ideally, we'd separate these out so that only 1 assert per "it" block
          // And ideally, we'd make this check everything
          const raffleState = (await raffle.getRaffleState()).toString();
          // Comparisons for Raffle initialization:
          assert.equal(raffleState, "0");
          assert.equal(
            interval.toString(),
            networkConfig[network.config.chainId]["keepersUpdateInterval"]
          );
        });
      });

      describe("enterRaffle", function () {
        it("reverts when you don't pay enough", async () => {
          await expect(raffle.enterRaffle()).to.be.revertedWith(
            // is reverted when not paid enough or raffle is not open
            "Raffle__SendMoreToEnterRaffle"
          );
        });

        it("records player when they enter", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          const contractPlayer = await raffle.getPlayer(0);
          assert.equal(player.address, contractPlayer);
        });

        it("emits event on enter", async () => {
          await expect(
            raffle.enterRaffle({ value: raffleEntranceFee })
          ).to.emit(
            // emits RaffleEnter event if entered to index player(s) address
            raffle,
            "RaffleEnter"
          );
        });

        it("doesn't allow entrance when raffle is calculating", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          // for a documentation of the methods below, go here: https://hardhat.org/hardhat-network/reference
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          // we pretend to be a keeper for a second
          await raffle.performUpkeep([]); // changes the state to calculating for our comparison below
          await expect(
            raffle.enterRaffle({ value: raffleEntranceFee })
          ).to.be.revertedWith(
            // is reverted as raffle is calculating
            "Raffle__RaffleNotOpen"
          );
        });
      });

      describe("checkUpkeep", function () {
        it("returns false if people haven't sent any ETH", async function () {
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1 /* jump forward in time */,
          ]);
          await network.provider.send("evm_mine", []);
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
          assert(!upkeepNeeded); // returning false
        });

        it("returns false if raffle isn't open", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          await raffle.performUpkeep("0x"); // interpreted by hardhat as a blank bytes object
          const raffleState = await raffle.getRaffleState();
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
          assert.equal(raffleState.toString(), "1");
          assert.equal(upkeepNeeded, false);
        });

        it("returns false if enough time hasn't passed", async () => {
          /* upkeep == interval has passed */
          await raffle.enterRaffle({ value: raffleEntranceFee }); //enter raffle with entranceFee (set when creating an instance of the contract) - here set to 10000000000000000
          await network.provider.send("evm_increaseTime", [
            // DECREASE time
            interval.toNumber() - 10, // use a higher number here if this test fails
          ]);
          await network.provider.request({ method: "evm_mine", params: [] }); // mine a block

          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
          assert(!upkeepNeeded);
        });

        it("returns true if enough time has passed, has players, eth, and is open", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
          assert(upkeepNeeded);
        });
      });

      describe("performUpkeep", function () {
        it("can only run if upkeep equals true", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            // simulate time passing - one condition for performUpkeep to run
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []); // simulate mining - new transaction
          const tx = await raffle.performUpkeep([]);
          assert(tx); // if tx is truthy - if checkUpkeep returns false, so does performUpkeep
        });

        it("reverts when checkupkeep is false", async function () {
          await expect(raffle.performUpkeep([])).to.be.revertedWith(
            "Raffle__UpkeepNotNeeded" // this CAN Be made more specific by adding the arguments that go into this error but eh
          );
        });

        it("updates the raffle state, emits an event and calls the vrf coordinator", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const txResponse = await raffle.performUpkeep([]); // perform it with blank bytes object - no content needed
          const txReceipt = await txResponse.wait(1); // wait a block
          const requestId = txReceipt.events[1].args.requestId; // detect triggered event here
          const raffleState = await raffle.getRaffleState();
          assert(requestId.toNumber() > 0);
          assert(raffleState == 1);
        });
      });

      describe("fulfillRandomWords", function () {
        beforeEach(async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
        });

        it("can only be called after performUpkeep", async function () {
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address) // reverts if not fulfilled
          ).to.be.revertedWith("nonexistent request");

          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
          ).to.be.revertedWith("nonexistent request");
        });

        it("picks a winner, resets the lottery and sends money", async function () {
          const additionalEntrants = 3;
          const startingAccountIndex = 1; // deployer = 0;
          const accounts = await ethers.getSigners(); //
          for (
            let i = startingAccountIndex;
            i < startingAccountIndex + additionalEntrants;
            i++
          ) {
            const accountConnectedRaffle = raffle.connect(accounts[i]);
            await accountConnectedRaffle.enterRaffle({
              value: raffleEntranceFee,
            });
            // mock being the chainLink keeper and the VRF
            // fulfillRandomWords()
            // wait for fulfillRandomWords() to be called
          }
          const startingTimeStamp = await raffle.getLastTimeStamp();

          await new Promise(async (resolve, reject) => {
            let winnerStartingBalance;

            raffle.once("WinnerPicked", async () => {
              console.log("Event has been fired");
              try {
                const raffleState = await raffle.getRaffleState();
                const endingTimeStamp = await raffle.getLastTimeStamp();
                const winnerEndingBalance = await accounts[1].getBalance();
                await expect(raffle.getPlayer(0)).to.be.reverted;
                assert.equal(raffleState, 0);
                assert(endingTimeStamp > startingTimeStamp);
                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance
                    .add(
                      raffleEntranceFee // recover entrance fee
                        .mul(additionalEntrants) // multiply entrance fee by number of additional entrants
                        .add(raffleEntranceFee) // add one entrant fee
                    )
                    .toString()
                );
                resolve();
              } catch (e) {
                reject(e);
              }
            });

            try {
              const tx = await raffle.performUpkeep([]);
              const txReceipt = await tx.wait(1);
              winnerStartingBalance = await accounts[1].getBalance();
              await vrfCoordinatorV2Mock.fulfillRandomWords(
                // fires WinnerPicked event
                txReceipt.events[1].args.requestId,
                raffle.address
              );
            } catch (e) {
              reject(e);
            }
          });
        });
      });
    });

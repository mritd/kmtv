import XCTest
@testable import KMTV

/// Covers every transition of the app's root state machine and its session epoch.
///
/// 覆盖 App 根状态机的每个转换及其会话纪元.
final class AppSessionMachineTests: XCTestCase {
    private let identity = DownloadIdentity(serverURL: "https://kmtv.example", userID: 5, username: "alice")

    /// A machine in `state`, reached through the events the app sends, at a fresh epoch.
    ///
    /// 通过 App 发送的事件到达 `state` 的状态机, 处于新的纪元.
    private func machine(in state: AppState) -> AppSessionMachine {
        var machine = AppSessionMachine()
        machine.send(.beginSession)
        switch state {
        case .loading:
            break
        case .serverSetup:
            machine.send(.needsSetup(epoch: machine.epoch))
        case .authenticated:
            machine.send(.signedIn(epoch: machine.epoch))
        case .offline(let identity):
            machine.send(.wentOffline(identity, epoch: machine.epoch))
        case .incompatibleServer(let serverVersion, let requiredVersion):
            machine.send(.signedIn(epoch: machine.epoch))
            machine.send(.serverIncompatible(serverVersion: serverVersion, requiredVersion: requiredVersion,
                                             epoch: machine.epoch))
        }
        XCTAssertEqual(machine.state, state)
        return machine
    }

    private var allStates: [AppState] {
        [.loading, .serverSetup, .authenticated, .offline(identity), .offline(nil),
         .incompatibleServer(serverVersion: "v1.0.0", requiredVersion: "v1.1.0")]
    }

    func testStartsLoadingAtEpochZero() {
        let machine = AppSessionMachine()
        XCTAssertEqual(machine.state, .loading)
        XCTAssertEqual(machine.epoch, 0)
        XCTAssertTrue(machine.isCurrent(0))
    }

    func testBeginSessionBumpsTheEpochAndKeepsTheScreen() {
        for state in allStates {
            var machine = machine(in: state)
            let before = machine.epoch
            XCTAssertTrue(machine.send(.beginSession))
            XCTAssertEqual(machine.epoch, before + 1)
            XCTAssertFalse(machine.isCurrent(before), "a step of the previous session is stale")
            XCTAssertEqual(machine.state, state)
        }
    }

    func testReconnectShowsLoadingFromAnyStateWithoutANewEpoch() {
        for state in allStates {
            var machine = machine(in: state)
            let epoch = machine.epoch
            XCTAssertTrue(machine.send(.reconnect))
            XCTAssertEqual(machine.state, .loading)
            XCTAssertEqual(machine.epoch, epoch, "the bootstrap that follows starts the session")
        }
    }

    func testNeedsSetupAppliesOnlyForTheCurrentEpoch() {
        var machine = machine(in: .loading)
        let stale = machine.epoch
        machine.send(.beginSession)
        XCTAssertFalse(machine.send(.needsSetup(epoch: stale)))
        XCTAssertEqual(machine.state, .loading)

        XCTAssertTrue(machine.send(.needsSetup(epoch: machine.epoch)))
        XCTAssertEqual(machine.state, .serverSetup)
    }

    func testSignedInAppliesOnlyForTheCurrentEpoch() {
        for state in allStates {
            var machine = machine(in: state)
            let stale = machine.epoch
            machine.send(.beginSession)
            XCTAssertFalse(machine.send(.signedIn(epoch: stale)), "a late sign-in for a left session from \(state)")
            XCTAssertEqual(machine.state, state)
        }
        var machine = machine(in: .serverSetup)
        XCTAssertTrue(machine.send(.signedIn(epoch: machine.epoch)))
        XCTAssertEqual(machine.state, .authenticated)
    }

    func testServerIncompatibleNeedsTheCurrentSignedInSession() {
        let incompatible = AppEvent.serverIncompatible(serverVersion: "v1.0.6", requiredVersion: "v1.1.0", epoch: 1)
        var signedIn = machine(in: .authenticated)
        XCTAssertTrue(signedIn.send(incompatible))
        XCTAssertEqual(signedIn.state, .incompatibleServer(serverVersion: "v1.0.6", requiredVersion: "v1.1.0"))
        XCTAssertEqual(signedIn.epoch, 1, "the version check keeps the session's epoch")

        for state in allStates where state != .authenticated {
            var other = machine(in: state)
            XCTAssertFalse(other.send(incompatible), "only a signed-in session checks the version, not \(state)")
            XCTAssertEqual(other.state, state)
        }

        var stale = machine(in: .authenticated)
        stale.send(.beginSession)
        XCTAssertFalse(stale.send(incompatible))
        XCTAssertEqual(stale.state, .authenticated)
    }

    func testWentOfflineAppliesOnlyForTheCurrentEpoch() {
        var machine = machine(in: .loading)
        let stale = machine.epoch
        machine.send(.beginSession)
        XCTAssertFalse(machine.send(.wentOffline(identity, epoch: stale)))
        XCTAssertEqual(machine.state, .loading)

        XCTAssertTrue(machine.send(.wentOffline(identity, epoch: machine.epoch)))
        XCTAssertEqual(machine.state, .offline(identity))
    }

    func testOpeningOfflineDropsTheBootstrapStillRunning() {
        // A bootstrap starts, then the user opens downloads offline before `me()` answers.
        //
        // 启动流程开始后, 用户在 `me()` 返回前离线打开下载.
        var machine = AppSessionMachine()
        machine.send(.beginSession)
        let bootstrap = machine.epoch
        machine.send(.beginSession)
        XCTAssertTrue(machine.send(.wentOffline(nil, epoch: machine.epoch)))

        XCTAssertFalse(machine.send(.signedIn(epoch: bootstrap)))
        XCTAssertFalse(machine.send(.needsSetup(epoch: bootstrap)))
        XCTAssertFalse(machine.send(.wentOffline(identity, epoch: bootstrap)))
        XCTAssertEqual(machine.state, .offline(nil))
    }

    func testResetAlwaysShowsSetupAndStartsANewEpoch() {
        for state in allStates {
            var machine = machine(in: state)
            let before = machine.epoch
            XCTAssertTrue(machine.send(.reset))
            XCTAssertEqual(machine.state, .serverSetup)
            XCTAssertEqual(machine.epoch, before + 1, "a bootstrap or connect still running must drop its result")
        }
    }

    func testSessionExpiredResetsEveryStateButOffline() {
        for state in allStates {
            var machine = machine(in: state)
            let before = machine.epoch
            let applied = machine.send(.sessionExpired)
            if case .offline = state {
                XCTAssertFalse(applied, "a late 401 must not end offline mode")
                XCTAssertEqual(machine.state, state)
                XCTAssertEqual(machine.epoch, before)
            } else {
                XCTAssertTrue(applied)
                XCTAssertEqual(machine.state, .serverSetup)
                XCTAssertEqual(machine.epoch, before + 1)
            }
        }
    }

    func testLogoutDuringBootstrapDropsTheLateUser() {
        var machine = AppSessionMachine()
        machine.send(.beginSession)
        let bootstrap = machine.epoch
        // `logout()` begins a session, then resets.
        //
        // `logout()` 先开始新会话, 然后重置.
        machine.send(.beginSession)
        machine.send(.reset)
        XCTAssertFalse(machine.send(.signedIn(epoch: bootstrap)))
        XCTAssertEqual(machine.state, .serverSetup)
    }

    func testRejectedEventsChangeNothing() {
        var machine = machine(in: .offline(identity))
        let before = machine
        XCTAssertFalse(machine.send(.sessionExpired))
        XCTAssertFalse(machine.send(.signedIn(epoch: machine.epoch - 1)))
        XCTAssertFalse(machine.send(.serverIncompatible(serverVersion: "v1", requiredVersion: "v2", epoch: machine.epoch)))
        XCTAssertEqual(machine.state, before.state)
        XCTAssertEqual(machine.epoch, before.epoch)
    }
}

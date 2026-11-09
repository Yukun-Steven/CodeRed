import { useEffect, useRef, useState, type FormEvent } from 'react';
import GameCanvas from './components/GameCanvas';
import RoomEntry from './components/RoomEntry';
import { socket, type ChatMessage, type Facing, type Progress, type Room, type Stage } from './network/socket';
import CodeWorkspace from './components/CodeWorkspace';
import ResultsScreen from './components/ResultsScreen';
import { EventBus } from './game/EventBus';
import { type Role } from './game/data/challenges';

export default function App() {
  // Room Entry: save the server-approved room and our player ID.
  const [joinedRoom, setJoinedRoom] = useState<Room | null>(null);
  const [myPlayerId, setMyPlayerId] = useState('');
  const [lobbyError, setLobbyError] = useState('');
  const [stage, setStage] = useState<Stage>('lobby');
  const [durationMs, setDurationMs] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState('');
  const [now, setNow] = useState(Date.now());
  const chatInput = useRef<HTMLInputElement>(null);
  const chatHistory = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage>('lobby');
  const [starting, setStarting] = useState(false);
  // Reconnect: remember who we are so a dropped connection can rejoin the same room.
  const [connected, setConnected] = useState(socket.connected);
  const [entryNotice, setEntryNotice] = useState('');
  const nameRef = useRef('');
  const roomCodeRef = useRef('');

  const me = joinedRoom?.players.find(player => player.id === myPlayerId);
  const role: Role | null = me?.role ?? null;
  const ready = me?.ready ?? false;
  const isHost = joinedRoom?.hostId === myPlayerId;

  // Team Progress comes from the server, so all three players see the same number.
  const completed = Object.values(joinedRoom?.progress ?? {}).filter(Boolean).length;
  const myPassed = role ? joinedRoom?.progress[role] ?? false : false;

  // The server decides when the mission starts for ALL three players.
  // Listening to room:update also handles a teammate leaving mid-mission.
  const roomCode = joinedRoom?.code;
  useEffect(() => {
    function enterMission(room: Room) {
      if (stageRef.current === 'mission') return;
      const myRole = room.players.find(player => player.id === myPlayerId)?.role;
      if (!myRole) return;

      stageRef.current = 'mission';
      setStage('mission');
      setStarting(false);
      setDeploying(false);
      setDeployError('');
      EventBus.dispatchEvent(new CustomEvent('mission:start', { detail: myRole }));
    }

    function updateRoom(room: Room) {
      if (room.code !== roomCode) return;
      setJoinedRoom(room);

      if (room.stage === 'mission') {
        enterMission(room);
      } else if (room.stage === 'lobby' && stageRef.current === 'mission') {
        // A teammate disconnected: backend returned the room to Lobby.
        stageRef.current = 'lobby';
        setStage('lobby');
        setStarting(false);
        setDeploying(false);
        setLobbyError('A player disconnected — mission reset');
        EventBus.dispatchEvent(new Event('lobby:return'));
      }
    }

    function gameStarted(data: { room: Room }) {
      updateRoom(data.room);
    }

    // Someone passed their challenge: update the shared scoreboard.
    function updateProgress(data: { progress: Progress; completed: number }) {
      setJoinedRoom(old => old && { ...old, progress: data.progress });
    }

    // The host deployed: everyone shows the results screen.
    function missionComplete(data: { room: Room; durationMs: number }) {
      if (data.room.code !== roomCode) return;
      setJoinedRoom(data.room);
      setDurationMs(data.durationMs);
      setDeploying(false);
      stageRef.current = 'complete';
      setStage('complete');
    }

    function updateMovement(data: {
      id: string; x: number; y: number; facing: Facing; flipX: boolean;
    }) {
      EventBus.dispatchEvent(new CustomEvent('lobby:player-moved', { detail: data }));
    }

    socket.on('room:update', updateRoom);
    socket.on('game:started', gameStarted);
    socket.on('player:moved', updateMovement);
    socket.on('mission:progress', updateProgress);
    socket.on('mission:complete', missionComplete);
    return () => {
      socket.off('room:update', updateRoom);
      socket.off('game:started', gameStarted);
      socket.off('player:moved', updateMovement);
      socket.off('mission:progress', updateProgress);
      socket.off('mission:complete', missionComplete);
    };
  }, [roomCode, myPlayerId]);

  useEffect(() => {
    roomCodeRef.current = joinedRoom?.code ?? '';
  }, [joinedRoom?.code]);

  // Our OWN connection dropped. The server removes us from the room straight away,
  // and the new connection gets a new socket id. So reset to Lobby and, once we are
  // connected again, join the same room again under the same name.
  useEffect(() => {
    let retryTimer = 0;
    let attempts = 0;

    function onDisconnect() {
      setConnected(false);
      window.clearTimeout(retryTimer);
      // On the results screen there is nothing to rejoin; Leave still works locally.
      if (!roomCodeRef.current || stageRef.current === 'complete') return;

      if (stageRef.current === 'mission') EventBus.dispatchEvent(new Event('lobby:return'));
      stageRef.current = 'lobby';
      setStage('lobby');
      setStarting(false);
      setDeploying(false);
      setDeployError('');
      setLobbyError('Connection lost — reconnecting…');
    }

    function rejoin() {
      const roomCode = roomCodeRef.current;
      const name = nameRef.current;
      if (!roomCode || !name || !socket.connected) return;
      attempts += 1;

      socket.timeout(7000).emit('room:join', { name, roomCode }, (err, res) => {
        if (roomCodeRef.current !== roomCode) return; // the player left meanwhile

        let error: string;
        if (err) {
          error = 'no response';
        } else if (res.ok) {
          attempts = 0;
          setJoinedRoom(res.room);
          setMyPlayerId(res.you); // new socket = new player id
          setLobbyError('Reconnected — choose your role and press Ready again');
          return;
        } else {
          error = res.error;
        }

        // The server may still be holding our old seat for a few seconds
        // (it has not noticed the old connection is gone yet). Try again.
        const retryable = err || error === 'ROOM_FULL' || error === 'GAME_ALREADY_STARTED';
        if (retryable && attempts < 5) {
          retryTimer = window.setTimeout(rejoin, 3000);
          return;
        }
        clearRoom('Connection lost and room ' + roomCode + ' could not be rejoined ('
          + error + '). Create or join a room again.');
      });
    }

    function onConnect() {
      setConnected(true);
      if (stageRef.current === 'complete') return;
      attempts = 0;
      rejoin();
    }

    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      window.clearTimeout(retryTimer);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, []);

  // Receive chat messages from the server, including our own messages.
  // Use only chat:message to update the history, so nobody sees duplicates.
  useEffect(() => {
    function receiveMessage(newMessage: ChatMessage) {
      setMessages(old => [...old.slice(-99), newMessage]);
    }

    socket.on('chat:message', receiveMessage);
    return () => { socket.off('chat:message', receiveMessage); };
  }, []);

  // Phaser starts asynchronously. When it is ready, send the latest room.
  // Also re-send when someone joins, leaves or changes their role.
  useEffect(() => {
    function syncScene() {
      if (!joinedRoom || !myPlayerId) return;
      EventBus.dispatchEvent(new CustomEvent('lobby:sync', {
        detail: { room: joinedRoom, playerId: myPlayerId },
      }));
    }
    EventBus.addEventListener('lobby:ready', syncScene);
    syncScene();
    return () => EventBus.removeEventListener('lobby:ready', syncScene);
  }, [joinedRoom, myPlayerId]);

  // Phaser sends local movement. React forwards it to Socket.IO.
  useEffect(() => {
    function move(event: Event) {
      const data = (event as CustomEvent<{
        x: number; y: number; facing: Facing; flipX: boolean;
      }>).detail;
      if (socket.connected) socket.emit('player:move', data);
    }
    EventBus.addEventListener('lobby:move', move);
    return () => EventBus.removeEventListener('lobby:move', move);
  }, []);

  // Press E at a desk: the backend approves or denies the role.
  useEffect(() => {
    function chooseRole(event: Event) {
      const wanted = (event as CustomEvent<{ role: Role | null }>).detail.role;
      const onReply = (err: Error | null, res?: { ok: boolean; error?: string }) => {
        const error = err ? 'Server did not respond' : res?.ok ? '' : (res?.error || 'Role request failed');
        setLobbyError(error);
        EventBus.dispatchEvent(new CustomEvent('lobby:role-result', { detail: { error } }));
      };
      if (wanted) {
        socket.timeout(5000).emit('role:select', { role: wanted }, onReply);
      } else {
        socket.timeout(5000).emit('role:cancel', {}, onReply);
      }
    }
    EventBus.addEventListener('lobby:role-request', chooseRole);
    return () => EventBus.removeEventListener('lobby:role-request', chooseRole);
  }, []);

  function changeReady() {
    socket.timeout(5000).emit('player:ready', { ready: !ready }, (err, res) => {
      if (err) setLobbyError('Server did not respond');
      else if (!res.ok) setLobbyError(res.error);
      else setLobbyError('');
    });
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (chatOpen) chatInput.current?.focus();
  }, [chatOpen]);

  useEffect(() => {
    if (chatOpen && chatHistory.current) {
      chatHistory.current.scrollTop = chatHistory.current.scrollHeight;
    }
  }, [chatOpen, messages]);

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && chatOpen) {
        event.preventDefault(); setChatOpen(false); chatInput.current?.blur(); return;
      }
      const focused = document.activeElement;
      const typing = focused?.tagName === 'INPUT' || focused?.tagName === 'TEXTAREA'
        || focused?.getAttribute('role') === 'textbox';
      if (typing) return;
      // Do not steal keyboard shortcuts from the Monaco editor.
      if (stage === 'mission' && document.activeElement?.closest('.code-workspace')) return;
      // Chat is closed on the results screen (the server ignores it there).
      if (stage !== 'complete' && event.key.toLowerCase() === 't' && !event.repeat) {
        event.preventDefault(); setChatOpen(true);
      }
      if (stage === 'lobby' && role && event.key.toLowerCase() === 'r' && !event.repeat) {
        changeReady();
      }
    }
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [role, ready, stage, chatOpen]);

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;

    if (!socket.connected) {
      setChatError('Server disconnected. Please try again.');
      return;
    }

    // The backend sends chat:message back to everyone in this room.
    socket.emit('chat:send', { text });
    setChatError('');
    setMessage('');
    setChatOpen(false);
    chatInput.current?.blur();
  }

  // Only the HOST may start (the server checks this too), and only when ALL are Ready.
  // We wait for game:started; an ACK alone never changes the scene.
  const allReady = joinedRoom?.stage === 'lobby' &&
    joinedRoom.players.length === 3 &&
    joinedRoom.players.every(player => player.ready && player.role !== null) &&
    new Set(joinedRoom.players.map(player => player.role)).size === 3;

  function startMission() {
    if (!allReady || !isHost || starting || !socket.connected) return;
    setStarting(true);
    setLobbyError('');
    socket.timeout(5000).emit('game:start', {}, (err, res) => {
      if (err) {
        setStarting(false);
        setLobbyError('Server did not respond to Start Mission');
      } else if (!res.ok) {
        setStarting(false);
        setLobbyError('Cannot start mission: ' + res.error);
      }
      // On success, game:started (sent to everyone) changes the scene.
    });
  }

  // At Team Progress 3/3 the host deploys. Like Start, we wait for mission:complete
  // (sent to everyone) before showing results; the ACK only reports errors.
  function deploy() {
    if (!isHost || completed < 3 || deploying || !socket.connected) return;
    setDeploying(true);
    setDeployError('');
    socket.timeout(5000).emit('deployment:request', {}, (err, res) => {
      if (err) {
        setDeploying(false);
        setDeployError('Server did not respond. Try Deploy again.');
      } else if (!res.ok) {
        setDeploying(false);
        setDeployError('Cannot deploy: ' + res.error);
      }
    });
  }

  // Leave the current room and return to Room Entry.
  function leaveRoom() {
    if (socket.connected) socket.emit('room:leave', {});
    clearRoom();
  }

  // Back to Room Entry. `notice` explains why, e.g. after a failed reconnect.
  function clearRoom(notice = '') {
    roomCodeRef.current = ''; // stops any pending rejoin attempt
    stageRef.current = 'lobby';
    setStage('lobby');
    setJoinedRoom(null);
    setMyPlayerId('');
    setMessages([]);
    setChatOpen(false);
    setMessage('');
    setChatError('');
    setLobbyError('');
    setDurationMs(0);
    setStarting(false);
    setDeploying(false);
    setDeployError('');
    setEntryNotice(notice);
  }

  const shown = chatOpen ? messages : messages.filter(m => now - m.time < 8000).slice(-4);
  const avatar = (name: string) => import.meta.env.BASE_URL + 'assets/characters/player_' + name + '.png';
  const task = joinedRoom?.mission.seats.find(seat => seat.roleId === role)?.challenge;
  const title = task?.title ?? joinedRoom?.mission.title ?? '';

  // The Lobby and Phaser canvas only mount after the server accepts join.
  if (!joinedRoom) {
    return <RoomEntry notice={entryNotice} onJoined={(room, playerId, name) => {
      nameRef.current = name;
      setEntryNotice('');
      setJoinedRoom(room);
      setMyPlayerId(playerId);
    }} />;
  }

  return (
    <div className={'app ' + (stage === 'lobby' ? 'app-lobby' : 'app-mission')}>
      <header className="top-bar">
        <div className="brand">
          <button type="button" className="brand-home" onClick={leaveRoom}
            title="Leave room and return to Room Entry"
            aria-label="Leave room and return to Room Entry">▣</button>{' '}
          <strong>CODE <em>RED!</em></strong>
        </div>
        <div className="stage-heading">
          {stage === 'lobby' ? 'Team Lobby' : stage === 'mission' ? joinedRoom.mission.title + ': ' + title : 'Mission Complete'}
          <span className="room-session-tag">
            {joinedRoom.code} · {joinedRoom.players.length}/3 · {joinedRoom.hostId === myPlayerId ? 'HOST' : 'PLAYER'}
          </span>
        </div>
        {stage !== 'lobby' && <div className="progress-badge">Team Progress <b>{completed} / 3</b></div>}
        <div className="players">
          {joinedRoom.players.map(player => (
            <div className="player-badge" key={player.id}>
              <img src={avatar(player.avatar)} alt="" />
              <div><b>{player.name}{player.id === myPlayerId ? ' (You)' : ''}</b>
              <small>{player.role || 'No role'}{player.ready ? ' · Ready' : ''}</small></div>
            </div>
          ))}
        </div>
      </header>

      <main className="game-screen">
        <div className="phaser-world"><GameCanvas /></div>

        {stage === 'lobby' ? (
          <>
            <section className="lobby-mission-card">
              <div className="eyebrow">{joinedRoom.mission.title}</div>
              <h2>{joinedRoom.mission.title}</h2>
              <p>☐ Fix critical bugs</p><p>☐ Pass tests</p><p>☐ Deploy to production</p>
            </section>
            <div className="lobby-instructions">WASD move · E select/cancel role · R ready · T chat</div>
            {lobbyError && <div style={{ position: 'absolute', top: 14, left: '50%',
              transform: 'translateX(-50%)', zIndex: 15, background: '#4c2235',
              border: '1px solid #ef637c', borderRadius: 6,
              color: 'white', padding: '9px 15px', fontSize: 16 }}>⚠ {lobbyError}</div>}
          </>
        ) : stage === 'mission' ? (
          <>
            <section className="mission-card">
              <div className="mission-warning">⚠</div>
              <div>
                <div className="eyebrow">{joinedRoom.mission.title}</div>
                <h2>{title}</h2>
                <p><span className={myPassed ? 'checked' : ''}>{myPassed ? '☑' : '☐'}</span> Fix the bug</p>
                <p><span className={myPassed ? 'checked' : ''}>{myPassed ? '☑' : '☐'}</span> Pass all tests</p>
                <p><span className={completed === 3 ? 'checked' : ''}>{completed === 3 ? '☑' : '☐'}</span> Sync with your team ({completed}/3)</p>

                {/* Deploy unlocks at 3/3. Only the host can press it. */}
                {completed === 3 && (
                  <div className="deploy-panel">
                    {isHost ? (
                      <button type="button" className="deploy-button"
                        disabled={deploying || !connected} onClick={deploy}>
                        {deploying ? 'Deploying…' : '🚀 Deploy to Production'}
                      </button>
                    ) : (
                      <span className="deploy-waiting">All tests passed · Waiting for host to deploy…</span>
                    )}
                    {deployError && <small className="deploy-error">⚠ {deployError}</small>}
                  </div>
                )}
              </div>
            </section>
            <div className="station-sign">✦ {role?.toUpperCase()} WORKSTATION ✦</div>
            {task && <CodeWorkspace key={joinedRoom.missionId + ':' + joinedRoom.missionRevision + ':' + role}
              task={task} missionTitle={joinedRoom.mission.title} missionId={joinedRoom.missionId} />}
          </>
        ) : (
          <ResultsScreen room={joinedRoom} durationMs={durationMs}
            myPlayerId={myPlayerId} onLeave={leaveRoom} />
        )}

        {(chatOpen || shown.length > 0) && (
          <section className={'game-chat ' + (chatOpen ? 'chat-open' : 'chat-closed')}>
            {chatOpen && <div className="chat-heading">◉ TEAM CHAT</div>}
            <div className="chat-history" ref={chatHistory}>
              {shown.map((line, i) => <div className="chat-line" key={i}><b>[{line.user}]</b> {line.text}</div>)}
            </div>
            {chatOpen && <form onSubmit={sendMessage}>
              <input ref={chatInput} value={message} maxLength={200} onChange={e => { setMessage(e.target.value); setChatError(''); }} placeholder="Message your team..." aria-label="Chat message" />
              <small>Enter to send · Esc to close</small>
              {chatError && <small style={{ color: '#ff8da1' }}>{chatError}</small>}
            </form>}
          </section>
        )}
      </main>

      {stage === 'lobby' && (
        <footer className="lobby-footer">
          <span>Role: <strong>{role || 'None'}</strong></span>
          <button type="button" disabled={!role} onClick={changeReady}>
            {ready ? 'Ready ✓ (R)' : 'Ready (R)'}
          </button>
          <button type="button" className="start-button"
            disabled={!allReady || !isHost || starting || !connected}
            onClick={startMission}>
            {starting ? 'Starting...' : '▶ Start Mission'}
          </button>
          <span className="demo-note">
            {!allReady ? 'Waiting for 3 players, 3 roles and everyone Ready'
              : isHost ? 'All 3 Ready · Start the mission!'
              : 'All 3 Ready · Waiting for the host to start'}
          </span>
        </footer>
      )}
    </div>
  );
}

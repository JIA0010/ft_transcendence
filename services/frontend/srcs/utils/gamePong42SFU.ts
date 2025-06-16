import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface GamePong42State {
  connected: boolean;
  error: string | null;
}

interface PlayerInfo {
  name: string;
  avatar?: string;
}

// プレイヤーのゲーム状態
interface PlayerGameState {
  playerId: string;
  playerName: string;
  gameState: {
    paddle1: { x: number; y: number; width: number; height: number };
    paddle2: { x: number; y: number; width: number; height: number };
    ball: { x: number; y: number; radius: number; dx: number; dy: number };
    canvasWidth: number;
    canvasHeight: number;
    score: { player1: number; player2: number };
  };
  timestamp: number;
  isActive: boolean;
}

const SFU_URL = 'http://localhost:3042';

// クライアント側で管理するゲーム状態の型定義
interface GamePong42LocalState {
  participantCount: number;
  countdown: number;
  gameStarted: boolean;
  gameOver: boolean;
  playerInfos: Map<string, PlayerInfo>;
  isRoomLeader: boolean;
  roomLeaderId: string | null;
  connectedPlayers: Set<string>;
  playerGameStates: Map<string, PlayerGameState>; // 他のプレイヤーのゲーム状態
}

// WebRTC経由で中継するデータの型定義
interface GamePong42Data {
  type: 'playerInput' | 'gameState' | 'gameEvent' | 'ping' | 'sharedState' | 'roomLeader';
  playerId: string;
  timestamp: number;
  payload: any;
}

// 共通データの型定義（Room Leaderが管理）
interface SharedGameState {
  countdown: number;
  gameStarted: boolean;
  gameOver: boolean;
  participantCount: number;
}

export const useGamePong42SFU = () => {
  const [state, setState] = useState<GamePong42State>({
    connected: false,
    error: null,
  });

  const [localGameState, setLocalGameState] = useState<GamePong42LocalState>({
    participantCount: 1,
    countdown: 30,
    gameStarted: false,
    gameOver: false,
    playerInfos: new Map(),
    isRoomLeader: false,
    roomLeaderId: null,
    connectedPlayers: new Set(),
    playerGameStates: new Map(), // 他のプレイヤーのゲーム状態
  });

  const socketRef = useRef<Socket | null>(null);
  const roomNumberRef = useRef<string | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const countdownStartedRef = useRef<boolean>(false); // カウントダウン開始済みフラグ
  const [receivedData, setReceivedData] = useState<GamePong42Data[]>([]);

  // Room Leaderのカウントダウン管理
  const startRoomLeaderCountdown = useCallback(() => {
    if (!localGameState.isRoomLeader || localGameState.gameStarted || countdownStartedRef.current) {
      console.log('⚠️ Countdown already started or not Room Leader');
      return;
    }

    console.log('🏆 Room Leader starting countdown');
    countdownStartedRef.current = true; // フラグを設定

    // Clear existing timer
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }

    let countdownValue = 30;
    setLocalGameState(prev => ({ ...prev, countdown: countdownValue }));

    // Broadcast countdown start
    if (socketRef.current) {
      socketRef.current.emit('room-leader-countdown', {
        action: 'start',
        countdown: countdownValue,
        timestamp: Date.now()
      });
    }

    countdownTimerRef.current = window.setInterval(() => {
      countdownValue--;
      setLocalGameState(prev => ({ ...prev, countdown: countdownValue }));

      // Broadcast countdown update
      if (socketRef.current) {
        socketRef.current.emit('room-leader-countdown', {
          action: 'update',
          countdown: countdownValue,
          timestamp: Date.now()
        });
      }

      // Check for game start conditions
      if (localGameState.participantCount >= 42 || countdownValue <= 0) {
        clearInterval(countdownTimerRef.current!);
        countdownStartedRef.current = false; // フラグをリセット
        startGame();
      }
    }, 1000);
  }, [localGameState.isRoomLeader, localGameState.gameStarted, localGameState.participantCount]);

  // Room Leaderになったときのログ出力のみ（自動カウントダウンは削除）
  useEffect(() => {
    if (localGameState.isRoomLeader && !localGameState.gameStarted) {
      console.log('👑 Became Room Leader - ready to start countdown when requested');
    }
  }, [localGameState.isRoomLeader, localGameState.gameStarted]);

  // Game start (Room Leader only)
  const startGame = useCallback(() => {
    if (!localGameState.isRoomLeader || localGameState.gameStarted) {
      return;
    }

    console.log('🎮 Room Leader starting game');

    const playerCount = localGameState.participantCount;
    const npcCount = Math.max(0, 42 - playerCount);

    setLocalGameState(prev => ({
      ...prev,
      gameStarted: true,
      countdown: 0
    }));

    // NPCリクエストをSFU経由で送信（Room Leaderのみ）
    if (socketRef.current && roomNumberRef.current) {
      console.log(`🤖 Requesting ${npcCount} NPCs for room ${roomNumberRef.current}`);

      socketRef.current.emit('npc-request', {
        type: 'join',
        roomNumber: roomNumberRef.current,
        npcCount,
        timestamp: Date.now()
      });
    }

    // Broadcast game start
    if (socketRef.current) {
      socketRef.current.emit('game-start', {
        playerCount,
        npcCount,
        timestamp: Date.now()
      });
    }
  }, [localGameState.isRoomLeader, localGameState.gameStarted, localGameState.participantCount]);

  // 接続状態を監視
  const connect = useCallback(() => {
    if (socketRef.current?.connected) {
      console.log('🔗 SFU already connected');
      return;
    }

    console.log('🔗 Connecting to SFU server:', SFU_URL);

    const socket = io(SFU_URL, {
      transports: ['websocket'],
      upgrade: false,
      rememberUpgrade: false,
      timeout: 20000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('✅ Connected to SFU server:', socket.id);
      playerIdRef.current = socket.id;
      setState(prev => ({ ...prev, connected: true, error: null }));
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 Disconnected from SFU server:', reason);
      setState(prev => ({ ...prev, connected: false }));
    });

    socket.on('connect_error', (error) => {
      console.error('❌ SFU connection error:', error);
      setState(prev => ({ ...prev, error: `Connection failed: ${error.message}` }));
    });

    // Room join confirmation (from SFU server)
    socket.on('room-join-confirmed', (data: { roomNumber: string; isRoomLeader: boolean; participantCount: number; timestamp: number }) => {
      console.log('🏠 Room join confirmed:', data);

      setLocalGameState(prev => ({
        ...prev,
        participantCount: data.participantCount,
        isRoomLeader: data.isRoomLeader,
        roomLeaderId: data.isRoomLeader ? playerIdRef.current : prev.roomLeaderId
      }));

      console.log(`👑 Room Leader status confirmed: isLeader=${data.isRoomLeader}, playerCount=${data.participantCount}`);
    });

    // Player joined (from SFU relay) - only for other players
    socket.on('player-joined', (data: { socketId: string; userId: string; participantCount: number; timestamp: number }) => {
      console.log('👤 Another player joined:', data);

      setLocalGameState(prev => {
        const newConnectedPlayers = new Set(prev.connectedPlayers);
        newConnectedPlayers.add(data.socketId);

        // 新しいプレイヤーをplayerGameStatesマップに追加（空の状態で初期化）
        const newPlayerGameStates = new Map(prev.playerGameStates);
        newPlayerGameStates.set(data.socketId, {
          playerId: data.socketId,
          playerName: data.userId,
          gameState: {
            paddle1: { x: 0, y: 0, width: 0, height: 0 },
            paddle2: { x: 0, y: 0, width: 0, height: 0 },
            ball: { x: 0, y: 0, radius: 0, dx: 0, dy: 0 },
            canvasWidth: 0,
            canvasHeight: 0,
            score: { player1: 0, player2: 0 }
          },
          timestamp: Date.now(),
          isActive: false
        });

        console.log(`🎮 Player count updated: ${data.participantCount} (another player: ${data.socketId})`);
        console.log(`📊 PlayerGameStates now has ${newPlayerGameStates.size} entries`);

        return {
          ...prev,
          connectedPlayers: newConnectedPlayers,
          participantCount: data.participantCount,
          playerGameStates: newPlayerGameStates
        };
      });
    });

    // Existing players list (received when joining a room with existing players)
    socket.on('existing-players-list', (data: { roomNumber: string; existingClients: string[]; timestamp: number }) => {
      console.log('📝 Received existing players list:', data);

      setLocalGameState(prev => {
        const newPlayerGameStates = new Map(prev.playerGameStates);
        const newConnectedPlayers = new Set(prev.connectedPlayers);

        // 既存のプレイヤーをplayerGameStatesマップに追加
        data.existingClients.forEach(clientId => {
          newConnectedPlayers.add(clientId);
          if (!newPlayerGameStates.has(clientId)) {
            newPlayerGameStates.set(clientId, {
              playerId: clientId,
              playerName: `Player ${clientId.slice(-4)}`,
              gameState: {
                paddle1: { x: 0, y: 0, width: 0, height: 0 },
                paddle2: { x: 0, y: 0, width: 0, height: 0 },
                ball: { x: 0, y: 0, radius: 0, dx: 0, dy: 0 },
                canvasWidth: 0,
                canvasHeight: 0,
                score: { player1: 0, player2: 0 }
              },
              timestamp: Date.now(),
              isActive: false
            });
          }
        });

        console.log(`📊 Added ${data.existingClients.length} existing players to game states map`);
        console.log(`📊 PlayerGameStates now has ${newPlayerGameStates.size} entries`);

        return {
          ...prev,
          connectedPlayers: newConnectedPlayers,
          playerGameStates: newPlayerGameStates
        };
      });
    });

    // Room leader assignment (when previous leader leaves)
    socket.on('room-leader-assigned', (data: { roomNumber: string; isRoomLeader: boolean; participantCount: number; timestamp: number }) => {
      console.log('👑 New room leader assigned:', data);

      setLocalGameState(prev => ({
        ...prev,
        isRoomLeader: data.isRoomLeader,
        roomLeaderId: data.isRoomLeader ? playerIdRef.current : prev.roomLeaderId,
        participantCount: data.participantCount
      }));

      if (data.isRoomLeader) {
        console.log('👑 You are now the Room Leader!');
      }
    });

    // Player left (from SFU relay)
    socket.on('player-left', (data: { socketId: string; participantCount: number; timestamp: number }) => {
      console.log('👋 Player left:', data);

      setLocalGameState(prev => {
        const newConnectedPlayers = new Set(prev.connectedPlayers);
        newConnectedPlayers.delete(data.socketId);

        console.log(`👥 Player count updated after leave: ${data.participantCount}`);

        return {
          ...prev,
          connectedPlayers: newConnectedPlayers,
          participantCount: data.participantCount
        };
      });
    });    // Room Leader countdown updates (relay from other Room Leader)
    socket.on('room-leader-countdown', (data: { action: string; countdown: number; from: string; timestamp: number }) => {
      console.log('📊 Room Leader countdown update:', data);

      // Only non-Room Leaders should update countdown from external source
      if (data.from !== playerIdRef.current) {
        console.log('⏰ Receiving countdown update from another Room Leader:', data.countdown);
        setLocalGameState(prev => {
          // Only update if this client is NOT the Room Leader
          if (!prev.isRoomLeader) {
            console.log('✅ Non-leader updating countdown to:', data.countdown);
            return {
              ...prev,
              countdown: data.countdown
            };
          } else {
            console.log('⚠️ Ignoring countdown update - this client is Room Leader');
            return prev;
          }
        });
      }
    });

    // Game start (relay from Room Leader or server)
    socket.on('game-start', (data: { playerCount: number; npcCount: number; from: string; timestamp: number; alreadyStarted?: boolean }) => {
      console.log('🎮 Game start relay:', data);

      if (data.from !== playerIdRef.current) {
        console.log(`✅ ${data.alreadyStarted ? 'Late joiner' : 'Non-leader'} receiving game start from ${data.from}`);
        setLocalGameState(prev => ({
          ...prev,
          gameStarted: true,
          countdown: 0
        }));
      }
    });

    // Game canvas data relay
    socket.on('game-canvas-data', (data: any) => {
      const gameData: GamePong42Data = {
        type: 'gameState',
        playerId: data.canvasId || 'unknown',
        timestamp: data.timestamp || Date.now(),
        payload: data.gameState
      };
      setReceivedData(prev => [...prev, gameData]);
    });

    // Player game over event
    socket.on('player-game-over', (data: { from: string; timestamp: number }) => {
      console.log('� GAMEOVER EVENT RECEIVED - Player game over received:', data);
      console.log('💀💀💀 IMPORTANT: Another player has been eliminated! 💀💀💀');

      // 該当プレイヤーのゲーム状態を非アクティブに設定
      setLocalGameState(prev => {
        const newPlayerGameStates = new Map(prev.playerGameStates);
        const playerState = newPlayerGameStates.get(data.from);

        console.log('🔍 Before update - playerGameStates:', {
          total: newPlayerGameStates.size,
          players: Array.from(newPlayerGameStates.entries()).map(([id, state]) => ({
            id,
            isActive: state.isActive,
            name: state.playerName
          }))
        });

        if (playerState) {
          newPlayerGameStates.set(data.from, {
            ...playerState,
            isActive: false
          });
          console.log(`🚫💀 Player ${data.from} set to inactive in playerGameStates`);
        } else {
          console.log(`⚠️❌ Player ${data.from} not found in playerGameStates`);
        }

        console.log('🔍 After update - playerGameStates:', {
          total: newPlayerGameStates.size,
          players: Array.from(newPlayerGameStates.entries()).map(([id, state]) => ({
            id,
            isActive: state.isActive,
            name: state.playerName
          }))
        });

        return {
          ...prev,
          playerGameStates: newPlayerGameStates
        };
      });

      const gameOverData: GamePong42Data = {
        type: 'gameEvent',
        playerId: data.from,
        timestamp: data.timestamp,
        payload: { event: 'game-over', ...data }
      };
      setReceivedData(prev => [...prev, gameOverData]);
    });

    // Player game state relay（他のプレイヤーのゲーム状態を受信）
    socket.on('player-game-state-relay', (data: { playerGameState: PlayerGameState }) => {
      console.log('📨 Frontend received player-game-state-relay from:', data.playerGameState.playerId, 'to:', playerIdRef.current);

      // 自分以外のプレイヤーからのゲーム状態のみ処理
      if (data.playerGameState.playerId !== playerIdRef.current) {
        console.log('✅ Processing game state from other player:', data.playerGameState.playerId);
        setLocalGameState(prev => {
          const newPlayerGameStates = new Map(prev.playerGameStates);
          newPlayerGameStates.set(data.playerGameState.playerId, {
            ...data.playerGameState,
            isActive: true // 受信したデータは必ずアクティブとして設定
          });

          // まだconnectedPlayersに存在しない場合は追加
          const newConnectedPlayers = new Set(prev.connectedPlayers);
          if (!newConnectedPlayers.has(data.playerGameState.playerId)) {
            newConnectedPlayers.add(data.playerGameState.playerId);
            console.log(`🆕 Added unknown player to connected list: ${data.playerGameState.playerId}`);
          }

          console.log(`📊 Updated playerGameStates, total: ${newPlayerGameStates.size}, active players:`, Array.from(newPlayerGameStates.keys()))

          // 🔧 重要な修正: 他のプレイヤーからゲーム状態を受信した場合、ゲームが開始されているとみなす
          const shouldStartGame = !prev.gameStarted && data.playerGameState.isActive;
          if (shouldStartGame) {
            console.log('🎮 Auto-starting game because received active game state from other player');
          }

          return {
            ...prev,
            playerGameStates: newPlayerGameStates,
            connectedPlayers: newConnectedPlayers,
            gameStarted: shouldStartGame ? true : prev.gameStarted, // ゲーム自動開始
          };
        });

        console.log('📨 Received game state from other player:', data.playerGameState.playerId);
      } else {
        console.log('⚠️ Ignoring own game state relay from:', data.playerGameState.playerId);
      }
    });

    // Error handling
    socket.on('error', (data: { message: string }) => {
      console.error('❌ SFU error:', data);
      setState(prev => ({ ...prev, error: data.message }));
    });

    // NPC response (SFU → client)
    socket.on('npc-response', (data: { success: boolean; data?: any; error?: string; timestamp: number }) => {
      console.log('🤖 NPC response:', data);

      if (data.success) {
        console.log('✅ NPC request successful:', data.data);
      } else {
        console.error('❌ NPC request failed:', data.error);
      }
    });

    // NPC status update (broadcast to all clients)
    socket.on('npc-status-update', (data: { roomNumber: string; npcCount: number; from: string; timestamp: number }) => {
      console.log('🔄 NPC status update:', data);

      // Update local state if necessary
      if (data.roomNumber === roomNumberRef.current) {
        console.log(`Room ${data.roomNumber} now has ${data.npcCount} NPCs`);
      }
    });    // NPCデータの受信 (npc_manager → SFU → client)
    socket.on('gamepong42-data', (data: any) => {
      console.log('🤖 Received NPC data:', data);

      // データ構造を確認
      const payload = data.payload || data;
      const npcStates = payload.npcStates || data.npcStates;

      console.log('📊 Data structure:', {
        hasPayload: !!data.payload,
        hasDirectNpcStates: !!data.npcStates,
        payloadNpcStatesCount: payload.npcStates?.length || 0,
        directNpcStatesCount: data.npcStates?.length || 0
      });

      // NPCデータをreceivedDataに追加
      if (npcStates && Array.isArray(npcStates)) {
        const npcData: GamePong42Data = {
          type: 'gameState',
          playerId: 'npc-manager',
          timestamp: Date.now(),
          payload: {
            npcStates: npcStates,
            survivors: payload.survivors || data.survivors || 42,
            roomNumber: payload.roomNumber || data.roomNumber
          }
        };

        setReceivedData(prev => [...prev.slice(-49), npcData]); // 最新50件を保持
        console.log('✅ NPC data processed and added to receivedData, count:', npcStates.length);
      } else {
        console.warn('⚠️ Received NPC data without valid npcStates:', data);
        console.warn('⚠️ Payload structure:', payload);
      }
    });

  }, []);

  // WebRTCデータ送信
  const sendData = useCallback((data: GamePong42Data) => {
    if (socketRef.current?.connected && roomNumberRef.current) {
      // Convert to game canvas data format expected by SFU
      if (data.type === 'gameState') {
        socketRef.current.emit('game-canvas-data', {
          canvasId: data.playerId,
          timestamp: data.timestamp,
          gameState: data.payload
        });
      } else if (data.type === 'gameEvent' && data.payload.event === 'game-over') {
        socketRef.current.emit('player-game-over', {
          playerId: data.playerId,
          ...data.payload
        });
      } else if (data.type === 'playerInput') {
        socketRef.current.emit('player-input', {
          input: data.payload,
          playerId: data.playerId,
          timestamp: data.timestamp
        });
      }
    }
  }, []);

  // 部屋に参加
  const joinRoom = useCallback((roomNumber: string, playerInfo: PlayerInfo) => {
    if (!socketRef.current?.connected) {
      console.error('❌ Cannot join room: Socket.IO not connected');
      return;
    }

    console.log('🏠 Joining GamePong42 room:', roomNumber);
    roomNumberRef.current = roomNumber;

    // Reset state - will be set by server response
    setLocalGameState(prev => ({
      ...prev,
      isRoomLeader: false,
      roomLeaderId: null,
      connectedPlayers: new Set(),
      participantCount: 0
    }));

    socketRef.current.emit('join-room', {
      roomNumber,
      userId: playerInfo.name
    });

    console.log('🏠 Join room request sent, waiting for server confirmation...');
  }, []);

  // 切断
  const disconnect = useCallback(() => {
    // Room LeaderがNPCを管理している場合、NPCを停止
    if (localGameState.isRoomLeader && roomNumberRef.current && socketRef.current) {
      console.log('🛑 Room Leader disconnecting, stopping NPCs');

      socketRef.current.emit('npc-request', {
        type: 'leave',
        roomNumber: roomNumberRef.current,
        timestamp: Date.now()
      });
    }

    // タイマーをクリア
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setState({
      connected: false,
      error: null,
    });

    // Reset local game state
    setLocalGameState({
      participantCount: 1,
      countdown: 30,
      gameStarted: false,
      gameOver: false,
      playerInfos: new Map(),
      isRoomLeader: false,
      roomLeaderId: null,
      connectedPlayers: new Set(),
      playerGameStates: new Map(), // 他のプレイヤーのゲーム状態
    });

    roomNumberRef.current = null;
    playerIdRef.current = null;
  }, [localGameState.isRoomLeader]);

  // プレイヤー入力送信
  const sendPlayerInput = useCallback((input: any) => {
    if (!playerIdRef.current) return;

    const data: GamePong42Data = {
      type: 'playerInput',
      playerId: playerIdRef.current,
      timestamp: Date.now(),
      payload: input
    };

    sendData(data);
  }, [sendData]);

  // ゲーム状態送信
  const sendGameState = useCallback((gameState: any) => {
    if (!playerIdRef.current) return;

    const data: GamePong42Data = {
      type: 'gameState',
      playerId: playerIdRef.current,
      timestamp: Date.now(),
      payload: gameState
    };

    sendData(data);
  }, [sendData]);

  // プレイヤーのゲーム状態を送信
  const sendPlayerGameState = useCallback((gameState: any) => {
    if (!socketRef.current) {
      console.log('⚠️ Cannot send player game state: socket not available');
      return;
    }

    if (!playerIdRef.current) {
      console.log('⚠️ Cannot send player game state: playerId not available');
      return;
    }

    if (!roomNumberRef.current) {
      console.log('⚠️ Cannot send player game state: roomNumber not available');
      return;
    }

    const playerGameData: PlayerGameState = {
      playerId: playerIdRef.current,
      playerName: `Player ${playerIdRef.current.slice(-4)}`,
      gameState: {
        paddle1: gameState.paddle1,
        paddle2: gameState.paddle2,
        ball: gameState.ball,
        canvasWidth: gameState.canvasWidth,
        canvasHeight: gameState.canvasHeight,
        score: { player1: 0, player2: 0 },
      },
      timestamp: Date.now(),
      isActive: true,
    };

    console.log('🚨 About to emit player-game-state from:', playerIdRef.current);
    socketRef.current.emit('player-game-state', {
      roomNumber: roomNumberRef.current,
      playerGameState: playerGameData,
    });
    console.log('✅ player-game-state emitted successfully');
  }, []);

  // ゲーム終了を送信
  const sendGameOver = useCallback((winner: number) => {
    console.log('� GAMEOVER EVENT START - Sending game over notification, winner:', winner);
    console.log('🔍 Connection status:', {
      socketConnected: !!socketRef.current,
      socketId: socketRef.current?.id,
      roomNumber: roomNumberRef.current,
      playerId: playerIdRef.current
    });

    if (socketRef.current && roomNumberRef.current) {
      const gameOverData = {
        winner: winner,
        playerId: playerIdRef.current,
        timestamp: Date.now()
      };

      console.log('📡 Emitting player-game-over event with data:', gameOverData);
      socketRef.current.emit('player-game-over', gameOverData);
      console.log('✅ player-game-over event emitted successfully');
    } else {
      console.error('❌ Cannot send game over: socket or room not available', {
        socketExists: !!socketRef.current,
        roomExists: !!roomNumberRef.current
      });
    }
  }, []);

  // NPC状態確認（Room Leaderのみ）
  const checkNPCStatus = useCallback(() => {
    if (!localGameState.isRoomLeader || !socketRef.current || !roomNumberRef.current) {
      return;
    }

    console.log('🔍 Checking NPC status');

    socketRef.current.emit('npc-request', {
      type: 'status',
      roomNumber: roomNumberRef.current,
      timestamp: Date.now()
    });
  }, [localGameState.isRoomLeader]);

  // NPC停止（Room Leaderのみ）
  const stopNPCs = useCallback(() => {
    if (!localGameState.isRoomLeader || !socketRef.current || !roomNumberRef.current) {
      return;
    }

    console.log('🛑 Stopping NPCs');

    socketRef.current.emit('npc-request', {
      type: 'leave',
      roomNumber: roomNumberRef.current,
      timestamp: Date.now()
    });
  }, [localGameState.isRoomLeader]);

  // NPC Game Management via SFU
  const createNPCGame = useCallback((gameConfig: any) => {
    if (!socketRef.current || !localGameState.isRoomLeader) {
      console.warn('⚠️ Cannot create NPC game: Not room leader or not connected');
      return Promise.reject(new Error('Not room leader or not connected'));
    }

    return new Promise((resolve, reject) => {
      const requestId = Date.now().toString();
      const timeout = setTimeout(() => {
        reject(new Error('NPC game creation timeout'));
      }, 10000);

      const responseHandler = (data: any) => {
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          socketRef.current?.off('npc-response', responseHandler);
          if (data.success) {
            resolve(data);
          } else {
            reject(new Error(data.error || 'Failed to create NPC game'));
          }
        }
      };

      socketRef.current.on('npc-response', responseHandler);

      socketRef.current.emit('npc-request', {
        type: 'create-game',
        requestId,
        gameConfig,
        roomNumber: roomNumberRef.current,
        timestamp: Date.now()
      });
    });
  }, [localGameState.isRoomLeader]);

  const applySpeedBoostToNPCGame = useCallback((gameId: string) => {
    if (!socketRef.current || !localGameState.isRoomLeader) {
      console.warn('⚠️ Cannot apply speed boost: Not room leader or not connected');
      return Promise.reject(new Error('Not room leader or not connected'));
    }

    return new Promise((resolve, reject) => {
      const requestId = Date.now().toString();
      const timeout = setTimeout(() => {
        reject(new Error('Speed boost timeout'));
      }, 10000);

      const responseHandler = (data: any) => {
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          socketRef.current?.off('npc-response', responseHandler);
          if (data.success) {
            resolve(data);
          } else {
            reject(new Error(data.error || 'Failed to apply speed boost'));
          }
        }
      };

      socketRef.current.on('npc-response', responseHandler);

      socketRef.current.emit('npc-request', {
        type: 'speed-boost',
        requestId,
        gameId,
        roomNumber: roomNumberRef.current,
        timestamp: Date.now()
      });
    });
  }, [localGameState.isRoomLeader]);

  const stopNPCGame = useCallback((gameId: string) => {
    if (!socketRef.current || !localGameState.isRoomLeader) {
      console.warn('⚠️ Cannot stop NPC game: Not room leader or not connected');
      return Promise.reject(new Error('Not room leader or not connected'));
    }

    return new Promise((resolve, reject) => {
      const requestId = Date.now().toString();
      const timeout = setTimeout(() => {
        reject(new Error('Stop game timeout'));
      }, 10000);

      const responseHandler = (data: any) => {
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          socketRef.current?.off('npc-response', responseHandler);
          if (data.success) {
            resolve(data);
          } else {
            reject(new Error(data.error || 'Failed to stop NPC game'));
          }
        }
      };

      socketRef.current.on('npc-response', responseHandler);

      socketRef.current.emit('npc-request', {
        type: 'stop-game',
        requestId,
        gameId,
        roomNumber: roomNumberRef.current,
        timestamp: Date.now()
      });
    });
  }, [localGameState.isRoomLeader]);

  // ゲーム状態のリセット機能
  const resetGameState = useCallback(() => {
    console.log('🔄 Resetting game state for new game');

    // ローカル状態をリセット
    setLocalGameState(prev => ({
      ...prev,
      countdown: 30,
      gameStarted: false,
      gameOver: false,
      isRoomLeader: false,
      roomLeaderId: null,
      // participantCountとconnectedPlayersは維持（接続は継続）
    }));

    // カウントダウンタイマーをクリア
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    // カウントダウン開始フラグをリセット
    countdownStartedRef.current = false;

    // 受信データをクリア
    setReceivedData([]);

    console.log('✅ Game state reset complete');
  }, []);

  return {
    // 接続状態
    connected: state.connected,
    error: state.error,

    // ローカルゲーム状態
    gameState: localGameState,

    // 受信データ
    receivedData,

    // 接続管理
    connect,
    disconnect,
    joinRoom,

    // データ送信
    sendPlayerInput,
    sendGameState,
    sendPlayerGameState, // プレイヤーゲーム状態送信
    sendGameOver, // ゲーム終了送信
    sendData,

    // Room Leader functions
    startRoomLeaderCountdown,
    startGame,
    checkNPCStatus,
    stopNPCs,

    // NPC Game Management via SFU
    createNPCGame,
    applySpeedBoostToNPCGame,
    stopNPCGame,

    // ゲーム管理
    resetGameState,

    // プレイヤー情報
    playerId: playerIdRef.current,
    roomNumber: roomNumberRef.current,
  };
};

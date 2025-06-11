import { useEffect, useRef, useCallback } from 'react';
import { GameEngine, GameConfig } from './gameEngine';

export const useGameEngine = (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  config?: GameConfig
) => {
  const engineRef = useRef<GameEngine | null>(null);
  const animationRef = useRef<number | undefined>(undefined);

  const initializeEngine = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const size = Math.min(window.innerWidth, window.innerHeight) * 0.9;
    canvas.width = size;
    canvas.height = size;

    engineRef.current = new GameEngine(size, size, config);
    return engineRef.current;
  }, [canvasRef, config]);

  const startGameLoop = useCallback((
    onScore: (scorer: 'player1' | 'player2') => void,
    gameStarted: boolean,
    keysRef: React.RefObject<{ [key: string]: boolean }>,
    paddleAndBallColor?: string, // 色パラメータ
    isPVEMode?: boolean, // PVEモードかどうか
    remotePlayerInput?: { up: boolean; down: boolean; timestamp: number } | null, // マルチプレイヤー入力
    playerNumber?: 1 | 2 | 'spectator' | null // プレイヤー番号（観戦者を含む）
  ) => {
    if (!engineRef.current || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const loop = () => {
      if (engineRef.current && gameStarted && keysRef.current) {
        // キーボード制御の処理
        const state = engineRef.current.getState();
        const speed = 8; // paddleSpeed

        // 観戦者モードの場合はキー入力を一切受け付けない
        if (playerNumber === 'spectator') {
          // 観戦者モード: キー入力は完全に無効
          // ゲーム状態の更新のみ行う（パドル移動なし）
        } else if (isPVEMode) {
          // PVEモード: Player1 = NPC, Player2 = プレイヤー
          // Player 2 controls (下のパドル)
          if (keysRef.current['arrowLeft'] || keysRef.current['a']) {
            if (state.paddle2.x > 0) {
              state.paddle2.x -= speed;
            }
          }
          if (keysRef.current['arrowRight'] || keysRef.current['d']) {
            if (state.paddle2.x + state.paddle2.width < state.canvasWidth) {
              state.paddle2.x += speed;
            }
          }
        } else if (remotePlayerInput && playerNumber && typeof playerNumber === 'number') {
          // マルチプレイヤーモード: プレイヤー番号に基づいて制御（観戦者を除く）
          if (playerNumber === 1) {
            // 自分がPlayer1（上のパドル）- 画面が180度回転しているので入力も反転
            if (keysRef.current['arrowLeft'] || keysRef.current['a']) {
              if (state.paddle1.x + state.paddle1.width < state.canvasWidth) {
                state.paddle1.x += speed; // 左キー → 右移動（画面回転により視覚的には左）
              }
            }
            if (keysRef.current['arrowRight'] || keysRef.current['d']) {
              if (state.paddle1.x > 0) {
                state.paddle1.x -= speed; // 右キー → 左移動（画面回転により視覚的には右）
              }
            }

            // リモートPlayer2（下のパドル）の入力を反映
            if (remotePlayerInput.up && state.paddle2.x > 0) {
              state.paddle2.x -= speed; // P2のup（左）
            }
            if (remotePlayerInput.down && state.paddle2.x + state.paddle2.width < state.canvasWidth) {
              state.paddle2.x += speed; // P2のdown（右）
            }
          } else if (playerNumber === 2) {
            // 自分がPlayer2（下のパドル）- 通常の制御
            if (keysRef.current['arrowLeft'] || keysRef.current['a']) {
              if (state.paddle2.x > 0) {
                state.paddle2.x -= speed;
              }
            }
            if (keysRef.current['arrowRight'] || keysRef.current['d']) {
              if (state.paddle2.x + state.paddle2.width < state.canvasWidth) {
                state.paddle2.x += speed;
              }
            }

            // リモートPlayer1（上のパドル）の入力を反映
            if (remotePlayerInput.up && state.paddle1.x > 0) {
              state.paddle1.x -= speed; // P1のup（左）
            }
            if (remotePlayerInput.down && state.paddle1.x + state.paddle1.width < state.canvasWidth) {
              state.paddle1.x += speed; // P1のdown（右）
            }
          }
        } else {
          // ローカルPVPモード: Player1 = プレイヤー, Player2 = プレイヤー
          // Player 1 controls (上のパドル) - WASDキー
          if (keysRef.current['a']) {
            if (state.paddle1.x > 0) {
              state.paddle1.x -= speed;
            }
          }
          if (keysRef.current['d']) {
            if (state.paddle1.x + state.paddle1.width < state.canvasWidth) {
              state.paddle1.x += speed;
            }
          }

          // Player 2 controls (下のパドル) - 矢印キー
          if (keysRef.current['arrowLeft']) {
            if (state.paddle2.x > 0) {
              state.paddle2.x -= speed;
            }
          }
          if (keysRef.current['arrowRight']) {
            if (state.paddle2.x + state.paddle2.width < state.canvasWidth) {
              state.paddle2.x += speed;
            }
          }
        }

        // パドル位置とplayers同期
        if (engineRef.current) {
          engineRef.current.syncPlayersPosition();
        }

        const result = engineRef.current.update();
        if (result !== 'none') {
          onScore(result);
        }
      }

      if (engineRef.current) {
        engineRef.current.draw(ctx, paddleAndBallColor || '#212121');
      }

      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);
  }, [canvasRef]);

  const stopGameLoop = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  }, []);

  return {
    engineRef,
    initializeEngine,
    startGameLoop,
    stopGameLoop,
  };
};

export const useKeyboardControls = () => {
  const keysRef = useRef<{ [key: string]: boolean }>({});

  useEffect(() => {
    const keyMap: Record<string, string> = {
      'a': 'a',
      'd': 'd',
      'ArrowLeft': 'arrowLeft',
      'ArrowRight': 'arrowRight',
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const mappedKey = keyMap[e.key];
      if (mappedKey) {
        e.preventDefault();
        keysRef.current[mappedKey] = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const mappedKey = keyMap[e.key];
      if (mappedKey) {
        keysRef.current[mappedKey] = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return keysRef;
};

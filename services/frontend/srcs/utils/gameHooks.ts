import { useEffect, useRef, useCallback } from 'react';
import { GameEngine, GameConfig } from './gameEngine';

export const useGameEngine = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  config?: GameConfig
) => {
  const engineRef = useRef<GameEngine | null>(null);
  const animationRef = useRef<number>();

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
    isPVEMode?: boolean // PVEモードかどうか
  ) => {
    if (!engineRef.current || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const loop = () => {
      if (engineRef.current && gameStarted && keysRef.current) {
        // キーボード制御の処理
        const state = engineRef.current.getState();
        const speed = 8; // paddleSpeed

        if (isPVEMode) {
          // PVEモード: Player1 = NPC, Player2 = プレイヤー
          // Player 2 controls (下のパドル)
          if (keysRef.current['arrowLeft'] && state.paddle2.x > 0) {
            state.paddle2.x -= speed;
          }
          if (keysRef.current['arrowRight'] && state.paddle2.x + state.paddle2.width < state.canvasWidth) {
            state.paddle2.x += speed;
          }
        } else {
          // PVPモード: Player1 = プレイヤー, Player2 = プレイヤー
          // Player 1 controls (上のパドル)
          if (keysRef.current['a'] && state.paddle1.x > 0) {
            state.paddle1.x -= speed;
          }
          if (keysRef.current['d'] && state.paddle1.x + state.paddle1.width < state.canvasWidth) {
            state.paddle1.x += speed;
          }

          // Player 2 controls (下のパドル)
          if (keysRef.current['arrowLeft'] && state.paddle2.x > 0) {
            state.paddle2.x -= speed;
          }
          if (keysRef.current['arrowRight'] && state.paddle2.x + state.paddle2.width < state.canvasWidth) {
            state.paddle2.x += speed;
          }
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

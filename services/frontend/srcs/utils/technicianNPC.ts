import { NPCConfig, GameState } from './npcTypes';
import { NPCAlgorithm, NPCFactory } from './npcEngine';

interface DifficultySettings {
  reactionDelay: number; // 反応遅延（ミリ秒）
  predictionAccuracy: number; // 予測精度（0-1）
  courseAccuracy: number; // コース精度（0-1）
}

enum TechniqueType {
  COURSE = 'course',
  STRAIGHT = 'straight',
  BOUNCE = 'bounce',
  DOUBLE_BOUNCE = 'double_bounce'
}

interface Action {
  technique: TechniqueType;
  targetPosition: number;
  utility: number;
}

export class TechnicianNPC implements NPCAlgorithm {
  private gameState: GameState;
  private difficulty: DifficultySettings;
  private lastUpdateTime: number = 0;
  private isReturning: boolean = false;
  private targetPosition: number = 0;
  private currentAction: Action | null = null;
  private config: NPCConfig;

  // パドル移動権利システム
  private hasMovementPermission: boolean = false;
  private permissionGrantedTime: number = 0;
  private lastGameState: { paddleHits: number } = { paddleHits: 0 };

  // 技の多様性のための変数
  private lastTechnique: TechniqueType | null = null;
  private techniqueHistory: TechniqueType[] = [];

  // 返球時の技効果フラグ
  private activeTechniqueEffect: {
    type: TechniqueType | null;
    shouldApply: boolean;
  } = {
    type: null,
    shouldApply: false
  };

  // 内部状態用の追加プロパティ
  private internalState = {
    npcPaddlePosition: 0,
    playerPaddlePosition: 0,
    fieldWidth: 800,
    fieldHeight: 400,
    paddleHeight: 12
  };

  // スムーズな移動のための補間用変数
  private smoothMovement = {
    currentX: 0,
    targetX: 0,
    speed: 8
  };

  // 予測安定化のための変数を追加
  private lastPredictedX: number = 0;
  private predictionStabilityThreshold: number = 30; // 30px以内の変動は無視

  // ビュー更新制限のための変数
  private lastViewUpdateTime: number = 0;
  private viewUpdateInterval: number = 1000; // 1秒間隔
  private cachedBallArrivalX: number = 0;

  constructor(config: NPCConfig) {
    this.config = config;
    this.difficulty = {
      reactionDelay: config.reactionDelayMs || 150,
      predictionAccuracy: config.technician?.predictionAccuracy || 0.85,
      courseAccuracy: config.technician?.courseAccuracy || 0.85
    };
    this.gameState = {
      ball: { x: 0, y: 0, dx: 0, dy: 0, radius: 8, speed: 4, speedMultiplier: 1 },
      paddle1: { x: 0, y: 0, width: 80, height: 12 },
      paddle2: { x: 0, y: 0, width: 80, height: 12 },
      canvasWidth: 800,
      canvasHeight: 400,
      paddleHits: 0
    };

    // 試合開始後すぐに権利を付与
    this.hasMovementPermission = true;
    this.permissionGrantedTime = Date.now();
    // 初回の時間更新を設定（すぐに次の権利を得られるように）
    this.lastViewUpdateTime = Date.now() - this.viewUpdateInterval;
  }

  public updateConfig(config: Partial<NPCConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.technician) {
      this.difficulty = {
        reactionDelay: config.reactionDelayMs || this.difficulty.reactionDelay,
        predictionAccuracy: config.technician.predictionAccuracy || this.difficulty.predictionAccuracy,
        courseAccuracy: config.technician.courseAccuracy || this.difficulty.courseAccuracy
      };
    }
  }

  public calculateMovement(gameState: GameState, npcPaddle: { x: number; y: number; width: number; height: number }): { targetX: number; movement: number; techniqueEffect?: any } {
    this.gameState = gameState;

    // GameStateから内部状態を更新
    this.updateInternalState(gameState, npcPaddle);

    // 現在のパドル位置を記録
    this.smoothMovement.currentX = npcPaddle.x + npcPaddle.width / 2;

    // 得点後の検出（paddleHitsがリセットされた場合）
    if (gameState.paddleHits < this.lastGameState.paddleHits) {
      // 得点が発生したので初回権利を付与
      this.grantInitialPermission();
    }
    this.lastGameState.paddleHits = gameState.paddleHits;

    // 1秒に1回のみビューを更新（権利付与）
    const currentTime = Date.now();
    if (currentTime - this.lastViewUpdateTime >= this.viewUpdateInterval) {
      this.lastViewUpdateTime = currentTime;
      this.cachedBallArrivalX = this.predictBallArrivalX(); // 新しい予測を計算

      // パドル移動権利を付与
      this.hasMovementPermission = true;
      this.permissionGrantedTime = currentTime;

      this.update(); // 技の選択も1秒に1回
    }

    // ボールがNPC側に向かっているかチェック
    const ballMovingToNPC = this.config.player === 1 ?
      this.gameState.ball.dy < 0 : this.gameState.ball.dy > 0;

    // 権利を持っていて、ボールがNPC側に向かっている場合のみパドルを動かす
    // または、権利を持っていて初回の場合（ボールの方向に関係なく）
    const shouldMove = this.hasMovementPermission && (ballMovingToNPC || this.isInitialMovement());

    if (shouldMove) {
      // キャッシュされた予測を使用（初回は現在のボール位置）
      const targetBallX = this.cachedBallArrivalX || this.gameState.ball.x;
      this.smoothMovement.targetX = targetBallX - npcPaddle.width / 2;

      // スムーズな移動を計算
      const deltaX = this.smoothMovement.targetX - this.smoothMovement.currentX;
      const movement = Math.sign(deltaX) * Math.min(Math.abs(deltaX), this.smoothMovement.speed);

      // 技効果の情報を含めて返す
      const result: any = {
        targetX: this.smoothMovement.targetX,
        movement: movement
      };

      // アクティブな技効果がある場合は追加
      if (this.activeTechniqueEffect.shouldApply) {
        result.techniqueEffect = {
          type: this.activeTechniqueEffect.type,
          forceVerticalReturn: this.activeTechniqueEffect.type === TechniqueType.STRAIGHT,
          player: this.config.player
        };
      }

      return result;
    } else {
      // 権利がないか、ボールが向かってこない場合は動かない
      return {
        targetX: this.smoothMovement.currentX,
        movement: 0
      };
    }
  }

  // 得点後の初回権利付与
  private grantInitialPermission(): void {
    this.hasMovementPermission = true;
    this.permissionGrantedTime = Date.now();

    // 現在のアクションをリセット（新しいラウンドの準備）
    this.currentAction = null;
    this.isReturning = false;

    // 予測をリセット
    this.cachedBallArrivalX = this.gameState.ball.x;

    // 技の履歴もリセット（新しいラウンドなので）
    this.lastTechnique = null;
  }

  // 初回移動判定（試合開始直後の位置取りのため）
  private isInitialMovement(): boolean {
    // permissionGrantedTimeから2秒以内かつ、まだアクションが計画されていない場合
    const timeSincePermission = Date.now() - this.permissionGrantedTime;
    return timeSincePermission < 2000 && !this.currentAction && !this.isReturning;
  }

  // 返球率を調整してゲームバランスを改善
  public getReturnSuccessRate(): number {
    const accuracyFactor = this.difficulty.predictionAccuracy * this.difficulty.courseAccuracy;
    // 最大返球率を98%に調整（95% → 98%に向上）
    return Math.min(0.98, accuracyFactor * 0.95); // 0.90 → 0.95に向上
  }

  private predictBallArrivalX(): number {
    const { ball } = this.gameState;
    const npcY = this.config.player === 1 ? this.gameState.paddle1.y : this.gameState.paddle2.y;

    // ボールがNPCの方向に向かっているかチェック
    const ballMovingToNPC = this.config.player === 1 ? ball.dy < 0 : ball.dy > 0;

    if (!ballMovingToNPC || Math.abs(ball.dy) < 0.1) {
      return ball.x; // ボールが向かってこない場合は現在位置
    }

    // NPCのパドル位置までの時間を計算
    const timeToReach = Math.abs((npcY - ball.y) / ball.dy);

    // X座標の予測（壁での反射を考慮）
    let futureX = ball.x + ball.dx * timeToReach;

    // 壁での反射を計算
    while (futureX < 0 || futureX > this.gameState.canvasWidth) {
      if (futureX < 0) {
        futureX = -futureX;
      } else if (futureX > this.gameState.canvasWidth) {
        futureX = 2 * this.gameState.canvasWidth - futureX;
      }
    }

    // 予測精度エラーを適用（ただし毎回は変更しない）
    const error = (1 - this.difficulty.predictionAccuracy) * 80; // 100 → 80に減少（精度向上）
    let predictedX = futureX;

    // 前回の予測から大きく変わった場合のみ新しいエラーを適用
    if (Math.abs(futureX - this.lastPredictedX) > this.predictionStabilityThreshold) {
      const randomError = (Math.random() - 0.5) * error;
      predictedX = futureX + randomError;

      // 意図的なミス頻度を調整
      const missChance = 1 - this.getReturnSuccessRate();
      if (Math.random() < missChance * 1.2) { // 1.5 → 1.2に減少（ミス頻度を下げる）
        const missError = (Math.random() - 0.5) * 250; // 300 → 250に減少
        predictedX = futureX + randomError + missError;
      }

      this.lastPredictedX = predictedX;
    } else {
      // 小さな変動の場合は前回の予測を維持（安定化）
      predictedX = this.lastPredictedX;
    }

    return Math.max(0, Math.min(this.gameState.canvasWidth, predictedX));
  }

  private updateInternalState(gameState: GameState, npcPaddle: { x: number; y: number; width: number; height: number }): void {
    this.internalState.npcPaddlePosition = npcPaddle.x + npcPaddle.width / 2; // X座標で管理
    this.internalState.playerPaddlePosition = this.config.player === 1 ?
      gameState.paddle2.x + gameState.paddle2.width / 2 :
      gameState.paddle1.x + gameState.paddle1.width / 2;
    this.internalState.fieldWidth = gameState.canvasWidth;
    this.internalState.fieldHeight = gameState.canvasHeight;
    this.internalState.paddleHeight = npcPaddle.height;
  }

  public update(): { paddlePosition: number; shouldReturn: boolean } {
    // ボールが自分の方向に向かっているかチェック
    const ballMovingToNPC = this.config.player === 1 ?
      this.gameState.ball.dy < 0 : this.gameState.ball.dy > 0;

    // 権利を持っていて、ボールがNPC側に向かっている場合のみアクションを計画
    // または、初回移動の場合
    const shouldPlanAction = this.hasMovementPermission &&
      (ballMovingToNPC || this.isInitialMovement()) &&
      !this.isReturning;

    if (shouldPlanAction) {
      // 反応遅延後にアクションを計画
      setTimeout(() => {
        this.planAction();
      }, this.difficulty.reactionDelay);

      // 権利を使用したのでリセット
      this.hasMovementPermission = false;
    }

    return this.executeCurrentAction();
  }

  private applyDiversityPenalty(actions: Action[]): Action[] {
    return actions.map(action => {
      let penaltyMultiplier = 1.0;

      // 前回と同じ技の場合、完全に排除
      if (this.lastTechnique === action.technique) {
        penaltyMultiplier = 0.0; // 完全に無効化
      }

      // 履歴に含まれる技の場合、軽いペナルティを適用
      const recentUsage = this.techniqueHistory.filter(t => t === action.technique).length;
      if (recentUsage > 0 && penaltyMultiplier > 0) {
        penaltyMultiplier *= Math.max(0.5, 1.0 - (recentUsage * 0.2));
      }

      return {
        ...action,
        utility: action.utility * penaltyMultiplier
      };
    });
  }

  private planAction(): void {
    const ballArrivalX = this.predictBallArrivalX();
    const actions = this.generatePossibleActions(ballArrivalX);

    // 連続使用ペナルティを適用
    const filteredActions = this.applyDiversityPenalty(actions);

    // 有効なアクション（utility > 0）のみを考慮
    const validActions = filteredActions.filter(action => action.utility > 0);

    // 有効なアクションがない場合は、前回以外の技から選択
    let bestAction: Action;
    if (validActions.length === 0) {
      const nonRepeatingActions = actions.filter(action => action.technique !== this.lastTechnique);
      bestAction = nonRepeatingActions.reduce((best, current) =>
        current.utility > best.utility ? current : best
      );
    } else {
      bestAction = validActions.reduce((best, current) =>
        current.utility > best.utility ? current : best
      );
    }

    this.currentAction = bestAction;
    this.isReturning = true;
    this.targetPosition = ballArrivalX;

    // 技の履歴を更新
    this.updateTechniqueHistory(bestAction.technique);
  }

  private updateTechniqueHistory(technique: TechniqueType): void {
    // 前回の技を記録
    this.lastTechnique = technique;

    // 履歴に追加（最大5個まで保持）
    this.techniqueHistory.push(technique);
    if (this.techniqueHistory.length > 5) {
      this.techniqueHistory.shift(); // 古いものを削除
    }
  }

  private generatePossibleActions(ballArrivalX: number): Action[] {
    const actions: Action[] = [];
    const isAtCenter = Math.abs(this.internalState.npcPaddlePosition - this.internalState.fieldWidth / 2) < 50;
    const isAtEdge = !isAtCenter;

    actions.push({
      technique: TechniqueType.COURSE,
      targetPosition: ballArrivalX,
      utility: this.calculateCourseUtility(isAtCenter)
    });

    actions.push({
      technique: TechniqueType.STRAIGHT,
      targetPosition: ballArrivalX,
      utility: this.calculateStraightUtility(isAtEdge)
    });

    actions.push({
      technique: TechniqueType.BOUNCE,
      targetPosition: ballArrivalX,
      utility: this.calculateBounceUtility()
    });

    actions.push({
      technique: TechniqueType.DOUBLE_BOUNCE,
      targetPosition: ballArrivalX,
      utility: this.calculateDoubleBounceUtility(isAtEdge)
    });

    return actions;
  }

  private calculateCourseUtility(isAtCenter: boolean): number {
    const playerPosition = this.internalState.playerPaddlePosition;
    const fieldCenter = this.internalState.fieldWidth / 2;

    // プレイヤーから遠い方向への返球を高く評価
    const distanceFromCenter = Math.abs(playerPosition - fieldCenter);
    let utility = 0.6 + (distanceFromCenter / fieldCenter) * 0.3;

    // 中央にいる場合はコースショットを優遇
    if (isAtCenter) {
      utility += 0.2;
    }

    // ランダム要素を追加
    utility += (Math.random() - 0.5) * 0.1;

    return Math.max(0.1, Math.min(1.0, utility));
  }

  private calculateStraightUtility(isAtEdge: boolean): number {
    let utility = 0.5;

    // 端にいる場合はストレートを少し優遇
    if (isAtEdge) {
      utility += 0.2;
    }

    // ランダム要素を追加
    utility += (Math.random() - 0.5) * 0.2;

    return Math.max(0.1, Math.min(1.0, utility));
  }

  private calculateBounceUtility(): number {
    // BOUNCEのユーティリティを下げて他の技も選ばれやすくする
    let utility = 0.4;

    // ランダム要素を追加
    utility += (Math.random() - 0.5) * 0.3;

    return Math.max(0.1, Math.min(1.0, utility));
  }

  private calculateDoubleBounceUtility(isAtEdge: boolean): number {
    let utility = 0.45;

    // 端にいる場合はダブルバウンドを優遇
    if (isAtEdge) {
      utility += 0.25;
    }

    // ランダム要素を追加
    utility += (Math.random() - 0.5) * 0.2;

    return Math.max(0.1, Math.min(1.0, utility));
  }

  private executeCurrentAction(): { paddlePosition: number; shouldReturn: boolean } {
    if (!this.currentAction) {
      this.activeTechniqueEffect.shouldApply = false;
      return {
        paddlePosition: this.moveToCenter(),
        shouldReturn: false
      };
    }

    let targetX = this.targetPosition;

    switch (this.currentAction.technique) {
      case TechniqueType.STRAIGHT:
        targetX = this.calculateStraightTarget();
        this.activeTechniqueEffect = {
          type: TechniqueType.STRAIGHT,
          shouldApply: true
        };
        break;

      case TechniqueType.COURSE:
        const playerPos = this.internalState.playerPaddlePosition;
        const fieldCenter = this.internalState.fieldWidth / 2;
        if (playerPos < fieldCenter) {
          targetX = this.internalState.fieldWidth * 0.8;
        } else {
          targetX = this.internalState.fieldWidth * 0.2;
        }
        this.activeTechniqueEffect.shouldApply = false;
        break;

      case TechniqueType.BOUNCE:
        targetX = this.calculateBounceTarget();
        this.activeTechniqueEffect.shouldApply = false;
        break;

      case TechniqueType.DOUBLE_BOUNCE:
        targetX = this.calculateDoubleBounceTarget();
        this.activeTechniqueEffect.shouldApply = false;
        break;
    }

    if (this.currentAction.technique !== TechniqueType.STRAIGHT) {
      const courseError = (1 - this.difficulty.courseAccuracy) * 40;
      const randomError = (Math.random() - 0.5) * courseError;
      targetX += randomError;
    }

    const newPosition = this.moveTowards(targetX);
    const shouldReturn = Math.abs(newPosition - targetX) < 25;

    if (shouldReturn) {
      this.currentAction = null;
      this.isReturning = false;
    }

    return {
      paddlePosition: newPosition,
      shouldReturn: shouldReturn
    };
  }

  /**
   * STRAIGHT技のための精密な位置計算
   * 5度以内の角度で返球するため、パドルの中央付近でボールを捉える
   */
  private calculateStraightTarget(): number {
    const ballX = this.gameState.ball.x;
    const ballY = this.gameState.ball.y;
    const ballDx = this.gameState.ball.dx;
    const ballDy = this.gameState.ball.dy;

    // NPCのパドル位置を取得
    const npcPaddle = this.config.player === 1 ? this.gameState.paddle1 : this.gameState.paddle2;
    const paddleY = npcPaddle.y;
    const paddleWidth = npcPaddle.width;

    // ボールがパドルに到達する時のX座標を予測
    let predictedBallX = ballX;

    if (Math.abs(ballDy) > 0.1) {
      const timeToReach = Math.abs((paddleY - ballY) / ballDy);
      predictedBallX = ballX + ballDx * timeToReach;

      // 壁での反射を考慮
      while (predictedBallX < 0 || predictedBallX > this.gameState.canvasWidth) {
        if (predictedBallX < 0) {
          predictedBallX = -predictedBallX;
        } else if (predictedBallX > this.gameState.canvasWidth) {
          predictedBallX = 2 * this.gameState.canvasWidth - predictedBallX;
        }
      }
    }

    // 5度以内の角度を保証するため、パドルの中央20%の範囲内で接触させる
    // 5度 ≈ tan(5°) ≈ 0.087 なので、パドル幅の8.7%以内で接触
    const maxOffset = paddleWidth * 0.087; // 5度に対応する最大オフセット
    const paddleCenter = predictedBallX;

    // パドルの中央にボールを合わせるためのターゲット位置
    // パドルの中央がボール位置に来るように調整
    let targetX = paddleCenter - paddleWidth / 2;

    // さらに精密な調整：現在のボールの水平速度を考慮
    // 水平速度が大きい場合は、より中央寄りに位置取り
    const horizontalSpeedFactor = Math.abs(ballDx) / (Math.abs(ballDx) + Math.abs(ballDy));
    const centeringAdjustment = horizontalSpeedFactor * maxOffset;

    if (ballDx > 0) {
      // ボールが右に移動している場合、少し左寄りに
      targetX -= centeringAdjustment;
    } else if (ballDx < 0) {
      // ボールが左に移動している場合、少し右寄りに
      targetX += centeringAdjustment;
    }

    // フィールド境界内に制限
    targetX = Math.max(0, Math.min(this.internalState.fieldWidth - paddleWidth, targetX));

    return targetX + paddleWidth / 2; // パドル中央座標として返す
  }

  private calculateBounceTarget(): number {
    const ballX = this.gameState.ball.x;
    const fieldWidth = this.internalState.fieldWidth;

    // 左右どちらかの壁で反射させる
    if (ballX < fieldWidth / 2) {
      // ボールが左半分にある場合、右壁で反射
      return fieldWidth * 0.85; // 右壁近く
    } else {
      // ボールが右半分にある場合、左壁で反射
      return fieldWidth * 0.15; // 左壁近く
    }
  }

  private calculateDoubleBounceTarget(): number {
    const ballX = this.gameState.ball.x;
    const fieldWidth = this.internalState.fieldWidth;

    // 2回反射を考慮した複雑な軌道
    if (ballX < fieldWidth / 3) {
      return fieldWidth * 0.9; // 右端で2回反射
    } else if (ballX > fieldWidth * 2 / 3) {
      return fieldWidth * 0.1; // 左端で2回反射
    } else {
      // 中央の場合はランダムに選択
      return Math.random() > 0.5 ? fieldWidth * 0.9 : fieldWidth * 0.1;
    }
  }

  private moveTowards(targetX: number): number {
    const currentX = this.internalState.npcPaddlePosition;
    const speed = 7; // 6 → 7に向上（移動速度向上）
    const direction = targetX > currentX ? 1 : -1;
    const distance = Math.abs(targetX - currentX);

    // 移動閾値（微細な移動を抑制するため）
    const moveThreshold = 15; // 20 → 15に減少（より精密な位置取り）
    if (distance < moveThreshold) {
      return currentX; // 現在位置を維持
    }

    if (distance < speed) {
      return targetX;
    }

    const newPosition = currentX + direction * speed;
    return Math.max(0, Math.min(this.internalState.fieldWidth, newPosition));
  }

  private moveToCenter(): number {
    const center = this.internalState.fieldWidth / 2;
    return this.moveTowards(center);
  }

  // 技効果をリセットするメソッド（ボールとの接触後に呼ばれる）
  public resetTechniqueEffect(): void {
    this.activeTechniqueEffect = {
      type: null,
      shouldApply: false
    };
  }

  // 現在のアクティブな技効果を取得（角度制限情報を追加）
  public getActiveTechniqueEffect(): {
    type: TechniqueType | null;
    forceVerticalReturn: boolean;
    maxAngleDegrees?: number;
  } {
    const effect = {
      type: this.activeTechniqueEffect.type,
      forceVerticalReturn: this.activeTechniqueEffect.type === TechniqueType.STRAIGHT && this.activeTechniqueEffect.shouldApply
    };

    // STRAIGHT技の場合は最大角度制限を追加
    if (effect.forceVerticalReturn) {
      return {
        ...effect,
        maxAngleDegrees: 15 // 15度以内に制限
      };
    }

    return effect;
  }

  public getDebugInfo(): any {
    return {
      algorithm: 'technician',
      currentAction: this.currentAction?.technique || 'none',
      lastTechnique: this.lastTechnique,
      techniqueHistory: this.techniqueHistory,
      targetPosition: this.targetPosition,
      isReturning: this.isReturning,
      returnSuccessRate: this.getReturnSuccessRate(),
      ballPosition: { x: this.gameState.ball.x, y: this.gameState.ball.y },
      npcPosition: this.internalState.npcPaddlePosition,
      activeTechniqueEffect: this.activeTechniqueEffect,
      hasMovementPermission: this.hasMovementPermission,
      permissionAge: this.permissionGrantedTime ? Date.now() - this.permissionGrantedTime : 0,
      isInitialMovement: this.isInitialMovement(), // 初回移動状態をデバッグ情報に追加
      lastPaddleHits: this.lastGameState.paddleHits, // デバッグ用
      techniqueDiversity: {
        consecutive: this.lastTechnique ? 1 : 0,
        historyLength: this.techniqueHistory.length,
        uniqueTechniques: [...new Set(this.techniqueHistory)].length
      }
    };
  }

  public getCurrentState(): string {
    return this.currentAction?.technique || 'IDLE';
  }

  public getStateStartTime(): number {
    return this.lastUpdateTime;
  }

  public getTargetPosition(): number {
    return this.targetPosition;
  }
}

// ファクトリーにアルゴリズムを登録
NPCFactory.registerAlgorithm('technician', TechnicianNPC);

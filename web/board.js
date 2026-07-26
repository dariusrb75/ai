/**
 * Thin wrapper over cm-chessboard.
 *
 * Keeps all the board-view concerns — markers, orientation, promotion dialog, input gating — in
 * one place so app.js deals only in game state.
 */

import {
  Chessboard,
  COLOR,
  INPUT_EVENT_TYPE,
  BORDER_TYPE,
  FEN,
} from './vendor/cm-chessboard/src/Chessboard.js';
import { Markers, MARKER_TYPE } from './vendor/cm-chessboard/src/extensions/markers/Markers.js';
import {
  PromotionDialog,
} from './vendor/cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js';

const LAST_MOVE = MARKER_TYPE.square;
const LEGAL_MOVE = MARKER_TYPE.dot;
const CHECK = MARKER_TYPE.circleDangerFilled;

export class BoardView {
  /**
   * @param {HTMLElement} element
   * @param {{
   *   onMoveAttempt: (from: string, to: string) => boolean,
   *   onMoveStart?: (square: string) => boolean,
   *   onMoveEnd?: () => void,
   * }} handlers
   */
  constructor(element, handlers) {
    this.handlers = handlers;
    this.inputColor = null;

    this.board = new Chessboard(element, {
      // Must be a real FEN, not the word "empty" — Position.setFen() indexes the fields.
      position: FEN.empty,
      assetsUrl: './vendor/cm-chessboard/assets/',
      style: {
        cssClass: 'default-contrast',
        // A frame puts the coordinates in their own margin. With borderType none they are drawn
        // on top of the squares, where they sit under the pieces on the first and last ranks.
        borderType: BORDER_TYPE.frame,
        showCoordinates: true,
        pieces: { file: 'pieces/standard.svg', tileSize: 40 },
        animationDuration: 220,
      },
      extensions: [
        // autoMarkers off: we drive the from-square highlight ourselves alongside the
        // last-move and check markers, so they can't fight each other.
        { class: Markers, props: { autoMarkers: MARKER_TYPE.frame } },
        { class: PromotionDialog },
      ],
    });
  }

  /** @param {'w'|'b'} color */
  setOrientation(color) {
    const target = color === 'b' ? COLOR.black : COLOR.white;
    if (this.board.getOrientation() !== target) {
      this.board.setOrientation(target, false);
    }
  }

  getOrientation() {
    return this.board.getOrientation();
  }

  setPosition(fen, animated) {
    return this.board.setPosition(fen, animated);
  }

  /**
   * Enables input for [color], or disables it entirely when null.
   *
   * Passing the colour to cm-chessboard means the player physically cannot pick up the
   * opponent's pieces, which is a much better feel than rejecting the move afterwards.
   */
  setInputColor(color) {
    if (this.inputColor === color) return;
    this.inputColor = color;

    this.board.disableMoveInput();
    if (!color) return;

    this.board.enableMoveInput((event) => {
      switch (event.type) {
        case INPUT_EVENT_TYPE.validateMoveInput:
          return this.handlers.onMoveAttempt(event.squareFrom, event.squareTo);

        case INPUT_EVENT_TYPE.moveInputStarted:
          // Returning false refuses to pick the piece up at all, which is how a piece with no
          // legal moves is handled — better feedback than letting it be dragged nowhere.
          return this.handlers.onMoveStart
            ? this.handlers.onMoveStart(event.squareFrom)
            : true;

        case INPUT_EVENT_TYPE.moveInputCanceled:
        case INPUT_EVENT_TYPE.moveInputFinished:
          if (this.handlers.onMoveEnd) this.handlers.onMoveEnd();
          return true;

        default:
          return true;
      }
    }, color === 'b' ? COLOR.black : COLOR.white);
  }

  /**
   * @param {string} square the promotion square
   * @param {'w'|'b'} color
   * @param {(piece: string|null) => void} done receives "q"/"r"/"b"/"n", or null if cancelled
   */
  askPromotion(square, color, done) {
    this.board.showPromotionDialog(
      square,
      color === 'b' ? COLOR.black : COLOR.white,
      (result) => {
        if (result && result.piece) {
          // cm-chessboard yields e.g. "wq"; chess.js wants just "q".
          done(result.piece.charAt(1));
        } else {
          done(null);
        }
      },
    );
  }

  /**
   * Redraws every marker.
   * @param {{lastMove?: {from: string, to: string}, legal?: string[], check?: string}} marks
   */
  setMarkers({ lastMove, legal, check }) {
    this.board.removeMarkers();
    if (lastMove) {
      this.board.addMarker(LAST_MOVE, lastMove.from);
      this.board.addMarker(LAST_MOVE, lastMove.to);
    }
    if (check) {
      this.board.addMarker(CHECK, check);
    }
    if (legal) {
      for (const square of legal) this.board.addMarker(LEGAL_MOVE, square);
    }
  }

  clearLegalMarkers() {
    this.board.removeMarkers(LEGAL_MOVE);
  }

  cancelInput() {
    this.board.cancelMoveInput();
  }
}

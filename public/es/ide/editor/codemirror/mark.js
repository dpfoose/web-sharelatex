/**
 * A mark identifies a range of source code that may be replaced with a
 * CodeMirror TextMarker.
 *
 * Marks MUST be treated as immutable, because they're used in the mode state,
 * and CodeMirror doesn't copy them for us (and we haven't implemented a custom
 * copyState for this mode).
 *
 * A mark is open when we've found its beginning but not its end; once we find
 * the end, we create a new closed mark to replace the open one, because marks
 * are immutable.
 *
 * Some properties of Marks:
 *
 * 1. Some kinds of marks can be nested, but marks never overlap in other ways.
 * The main reasons for allowing nesting is that we want to allow math in
 * section headings, and we also want to be able to handle labels in math. Math
 * within math is not desirable, because MathJAX can handle that itself. Math
 * within inline formatting is also not desirable, because it probably won't
 * have the effect that the user intended; e.g. math inside \textbf is not
 * actually rendered as bold.
 *
 * 2. No two marks are equal. Moreover, no inner or outer ranges are equal to
 * any other inner or outer ranges.
 *
 * 3. No closed mark has `to` equal to `from`, but `contentTo` may equal
 * `contentFrom`.
 *
 * 4. The order in which (closed) marks appear in the mode state is the order in
 * which they are closed. That is, the `to` positions are in ascending order in
 * the set of marks. The same is true of the `contentTo` positions.
 *
 */
export default class Mark {
  constructor(kind, from, contentFrom, contentTo, to, openParent) {
    this.kind = kind;
    this.from = from;
    this.to = to;
    this.contentFrom = contentFrom;
    this.contentTo = contentTo;
    this.openParent = openParent;
    this.checkedProperties = {};
  }

  /**
   * New shallow copy of an existing mark. Note: this copies only the standard
   * properties used in the constructor.
   *
   * @param {Mark} mark
   *
   * @return {Mark}
   */
  copy() {
    return new Mark(
      this.kind = kind,
      this.from = from,
      this.to = to,
      this.contentFrom = contentFrom,
      this.contentTo = contentTo,
      this.openParent = openParent
    )
  }
}
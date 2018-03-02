import CodeMirror from 'codemirror'

import LatexMode from 'Src/ide/editor/codemirror/LatexMode'

describe('LatexMode', function () {
  var _mode
  var _state

  beforeEach(function () {
    startParse()
  })

  function startParse () {
    _mode = new LatexMode()
    _state = _mode.startState()
  }

  var restartParse = startParse

  function parseLine (line) {
    if (line === '') {
      return [_mode.blankLine(_state)]
    } else {
      var stream = new CodeMirror.StringStream(line)
      var output = []
      while (!stream.eol()) {
        output.push(_mode.token(stream, _state))
        stream.start = stream.pos
      }
      return output
    }
  }

  // shorthand
  function pos (line, ch) {
    return new CodeMirror.Pos(line, ch)
  }

  it('highlights a command', function () {
    expect(parseLine('\\foo')).to.deep.equal(['tag'])
  })

  it('marks long title when there is a short one', function () {
    expect(parseLine('\\title[Short Title]{Long Title}')).to.deep.equal(
      ['tag', 'bracket', undefined, 'bracket', 'bracket', undefined, 'bracket']
    )
    expect(_state.marks.length).to.equal(1)
    expect(_state.marks[0].from).to.deep.equal(pos(0, 0))
    expect(_state.marks[0].to).to.deep.equal(pos(0, 31))
    expect(_state.marks[0].contentFrom).to.deep.equal(pos(0, 20))
    expect(_state.marks[0].contentTo).to.deep.equal(pos(0, 30))
  })

  it('marks long title alone', function () {
    parseLine('\\title{A Title}')
    expect(_state.marks.length).to.equal(1)
    expect(_state.marks[0].from).to.deep.equal(pos(0, 0))
    expect(_state.marks[0].to).to.deep.equal(pos(0, 15))
    expect(_state.marks[0].contentFrom).to.deep.equal(pos(0, 7))
    expect(_state.marks[0].contentTo).to.deep.equal(pos(0, 14))
  })

  it('marks dollar inline math', function () {
    parseLine('foo $x$ bar')
    expect(_state.marks.length).to.equal(1)
    expect(_state.marks[0].from).to.deep.equal(pos(0, 4))
    expect(_state.marks[0].to).to.deep.equal(pos(0, 7))
    expect(_state.marks[0].contentFrom).to.deep.equal(pos(0, 5))
    expect(_state.marks[0].contentTo).to.deep.equal(pos(0, 6))
  })

  it('handles unbalanced dollar math with open mark', function () {
    parseLine('foo $x bar')
    expect(_state.marks.length).to.equal(0)
    expect(_state.openMarks.length).to.equal(1)
    expect(_state.openMarks[0].from).to.deep.equal(pos(0, 4))
    expect(_state.openMarks[0].contentFrom).to.deep.equal(pos(0, 5))
    expect(_state.openMarks[0].to).to.deep.equal(undefined)
    expect(_state.openMarks[0].contentTo).to.deep.equal(undefined)
  })

  it('handles multi-line inline math', function () {
    parseLine('foo $x')
    expect(_state.marks.length).to.equal(0)
    expect(_state.openMarks.length).to.equal(1)
    expect(_state.openMarks[0].from).to.deep.equal(pos(0, 4))
    expect(_state.openMarks[0].contentFrom).to.deep.equal(pos(0, 5))
    parseLine('+y')
    expect(_state.marks.length).to.equal(0)
    expect(_state.openMarks.length).to.equal(1)
    expect(_state.openMarks[0].from).to.deep.equal(pos(0, 4))
    expect(_state.openMarks[0].contentFrom).to.deep.equal(pos(0, 5))
    parseLine('$')
    expect(_state.marks.length).to.equal(1)
    expect(_state.marks[0].from).to.deep.equal(pos(0, 4))
    expect(_state.marks[0].contentFrom).to.deep.equal(pos(0, 5))
    expect(_state.marks[0].to).to.deep.equal(pos(2, 1))
    expect(_state.marks[0].contentTo).to.deep.equal(pos(2, 0))
  })

  it('gives up on unbalanced dollar math at paragraph end', function () {
    parseLine('foo $x bar')
    expect(_state.marks.length).to.equal(0)
    expect(_state.openMarks.length).to.equal(1)
    parseLine('')
    expect(_state.marks.length).to.equal(0)
    expect(_state.openMarks.length).to.equal(0)
  })

  it('abandons unbalanced dollar before display math', function () {
    parseLine('foo $x bar $$x$$')
    expect(_state.marks.length).to.equal(1)
    expect(_state.openMarks.length).to.equal(0)
    expect(_state.marks[0].kind).to.equal('display-math')
    expect(_state.marks[0].from).to.deep.equal(pos(0, 11))
    expect(_state.marks[0].to).to.deep.equal(pos(0, 16))
    expect(_state.marks[0].contentFrom).to.deep.equal(pos(0, 13))
    expect(_state.marks[0].contentTo).to.deep.equal(pos(0, 14))
  })

  it('parses a section tag as it is typed', function () {
    expect(parseLine('\\sectio')).to.deep.equal(['tag'])
    restartParse()
    expect(parseLine('\\section')).to.deep.equal(['tag'])
    expect(_state.marks.length).to.equal(0)
    restartParse()
    expect(parseLine('\\section{')).to.deep.equal(['tag', 'bracket'])
    expect(_state.marks.length).to.equal(0)
    restartParse()
    expect(parseLine('\\section{abc')).to.deep.equal(
      ['tag', 'bracket', undefined]
    )
    expect(_state.marks.length).to.equal(0)
    restartParse()
    expect(parseLine('\\section{abc}')).to.deep.equal(
      ['tag', 'bracket', undefined, 'bracket']
    )
    expect(_state.marks.length).to.equal(1)
  })

  it('handles inline math in section heading', function () {
    parseLine('\\section{test $x$}')
    expect(_state.marks.length).to.equal(2)
    expect(_state.openMarks.length).to.equal(0)
    expect(_state.marks[0].kind).to.equal('inline-math')
    expect(_state.marks[0].from).to.deep.equal(pos(0, 14))
    expect(_state.marks[0].to).to.deep.equal(pos(0, 17))
    expect(_state.marks[0].contentFrom).to.deep.equal(pos(0, 15))
    expect(_state.marks[0].contentTo).to.deep.equal(pos(0, 16))
    expect(_state.marks[1].kind).to.equal('section')
    expect(_state.marks[1].from).to.deep.equal(pos(0, 0))
    expect(_state.marks[1].to).to.deep.equal(pos(0, 18))
    expect(_state.marks[1].contentFrom).to.deep.equal(pos(0, 9))
    expect(_state.marks[1].contentTo).to.deep.equal(pos(0, 17))
  })

  it('abandons outer mark when it is incomplete', function () {
    parseLine('\\section{test $x$')
    expect(_state.marks.length).to.equal(1)
    expect(_state.openMarks.length).to.equal(1)
    expect(_state.marks[0].kind).to.equal('inline-math')
    expect(_state.openMarks[0].kind).to.equal('section')
    parseLine('')
    expect(_state.marks.length).to.equal(1)
    expect(_state.openMarks.length).to.equal(0)
    expect(_state.marks[0].kind).to.equal('inline-math')
  })

  it('abandons inner outer mark when it is incomplete', function () {
    parseLine('\\section{test $x')
    expect(_state.marks.length).to.equal(0)
    expect(_state.openMarks.length).to.equal(2)
    expect(_state.openMarks[0].kind).to.equal('section')
    expect(_state.openMarks[1].kind).to.equal('inline-math')
    parseLine('')
    expect(_state.marks.length).to.equal(0)
    expect(_state.openMarks.length).to.equal(0)
  })

  it('ignores comments', function () {
    expect(parseLine('% $x$')).to.deep.equal(['comment'])
    expect(parseLine('%')).to.deep.equal(['comment'])
    expect(parseLine('abc %')).to.deep.equal([undefined, 'comment'])
    expect(parseLine('abc % def')).to.deep.equal([undefined, 'comment'])
  })

  it('finds maketitle only when it ends the line', function () {
    // this avoids a bug in the rich text display to do with trailing characters
    // after the hidden preamble end
    expect(parseLine('\\maketitle')).to.deep.equal(['tag'])
    expect(_state.marks.length).to.equal(1)
    restartParse()
    expect(parseLine('x \\maketitle')).to.deep.equal([undefined, 'tag'])
    expect(_state.marks.length).to.equal(1)
    restartParse()
    expect(parseLine('\\maketitle y')).to.deep.equal(['tag', undefined])
    expect(_state.marks.length).to.equal(0)
  })

  it('abandons equation environments after blank line', function () {
    parseLine('\\begin{equation}')
    parseLine('\\alpha')
    parseLine('')
    parseLine('\\end{equation}')
    expect(_state.marks.length).to.equal(0)
  })

  it('highlights non-breaking space', function () {
    expect(parseLine('a~b')).to.deep.equal([undefined, 'tag', undefined])
    expect(parseLine('$a~b$')).to.deep.equal(
      ['keyword', undefined, 'tag', undefined, 'keyword']
    )
  })

  it('highlights comment in math mode', function () {
    parseLine('\\begin{equation}')
    expect(parseLine('\\alpha % comment')).to.deep.equal(['tag', 'comment'])
    parseLine('\\end{equation}')
  })

  it('highlights arbitrary environments', function () {
    expect(parseLine('\\begin{foo}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('blah')).to.deep.equal([undefined])
    expect(parseLine('\\end{foo}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
  })

  it('highlights itemize and item', function () {
    expect(parseLine('\\begin{itemize}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('\\item okok')).to.deep.equal(['tag', undefined])
    expect(parseLine('\\end{itemize}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
  })

  it('highlights enumerate and item', function () {
    expect(parseLine('\\begin{enumerate}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('\\item okok')).to.deep.equal(['tag', undefined])
    expect(parseLine('\\end{enumerate}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
  })

  it('detects comment environment as comment', function () {
    expect(parseLine('\\begin{comment}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('\\foo')).to.deep.equal(['comment', 'comment'])
    expect(parseLine('\\end{comment}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
  })

  it('detects figure environment correctly', function () {
    expect(parseLine('\\begin{figure}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('\\end{figure}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
  })

  it('detects includegraphics command inside figure', function () {
    expect(parseLine('\\begin{figure}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('\\includegraphics[]{abc}')).to.deep.equal(
      ['tag', 'bracket', 'bracket', 'bracket', undefined, 'bracket']
    )
    expect(parseLine('\\end{figure}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
  })

  it('detects caption command inside figure', function () {
    expect(parseLine('\\begin{figure}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('\\caption{caption}')).to.deep.equal(
      ['tag', 'bracket', undefined, 'bracket']
    )
    expect(parseLine('\\end{figure}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
  })

  it('detects label command inside figure', function () {
    expect(parseLine('\\begin{figure}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('\\label{caption}')).to.deep.equal(
      ['tag', 'bracket', undefined, 'bracket']
    )
    expect(parseLine('\\end{figure}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
  })

  it('highlights \\verb', function () {
    // in math mode
    expect(parseLine('$\\verb|x|$')).to.deep.equal(
      ['keyword', 'tag', 'string', 'tag', 'keyword']
    )

    // do not match \\verbaXa as a \verb with switch "a" & string X
    expect(parseLine('\\verbaXa')).to.deep.equal(['tag'])

    // handle the star form
    expect(parseLine('\\verb*+x+')).to.deep.equal(['tag', 'string', 'tag'])
  })

  it('treat a tab as a single character when marking text', function () {
    expect(parseLine('\t\\textbf{foo}')).to.deep.equal(
      [undefined, 'tag', 'bracket', undefined, 'bracket']
    )
    expect(_state.marks.length).to.equal(1)
    expect(_state.marks[0].from).to.deep.equal(pos(0, 1))
    expect(_state.marks[0].contentFrom).to.deep.equal(pos(0, 9))
    expect(_state.marks[0].contentTo).to.deep.equal(pos(0, 12))
    expect(_state.marks[0].to).to.deep.equal(pos(0, 13))

    expect(parseLine('\t\\textbf{\tfoo\t}')).to.deep.equal(
      [undefined, 'tag', 'bracket', undefined, 'bracket']
    )
    expect(_state.marks.length).to.equal(2)
    expect(_state.marks[1].from).to.deep.equal(pos(1, 1))
    expect(_state.marks[1].contentFrom).to.deep.equal(pos(1, 9))
    expect(_state.marks[1].contentTo).to.deep.equal(pos(1, 14))
    expect(_state.marks[1].to).to.deep.equal(pos(1, 15))
  })

  it('correctly identifies enumerate environments', function () {
    parseLine('\\begin{enumerate}')
    var supposedOpenParent = _state.openMarks[_state.openMarks.length - 1]
    parseLine('\\item okok')
    var itemMark = _state.marks[_state.marks.length - 1]
    expect(itemMark.openParent).to.equal(supposedOpenParent)
    expect(itemMark.checkedProperties.number).to.equal(1)
    expect(itemMark.checkedProperties.kind).to.equal('enumerate-item')
    parseLine('\\end{enumerate}')
    expect(_state.marks.length).to.equal(2)
  })

  it('correctly identifies itemize environments', function () {
    parseLine('\\begin{itemize}')
    var supposedOpenParent = _state.openMarks[_state.openMarks.length - 1]
    parseLine('\\item okok')
    var itemMark = _state.marks[_state.marks.length - 1]
    expect(itemMark.openParent).to.equal(supposedOpenParent)
    expect(itemMark.checkedProperties.number).to.equal(1)
    expect(itemMark.checkedProperties.kind).to.equal('item')
    parseLine('\\end{itemize}')
    expect(_state.marks.length).to.equal(2)
  })

  it('correctly matches a blank line when parsing an optional argument', function () {
    parseLine('\\title[')
    parseLine('\n')
    parseLine(']{}')
    expect(_state.marks.length).to.equal(0)
  })

  it('highlights if command has a marked command as a prefix', function () {
    expect(parseLine('\\authorblockN{Name}')).to.deep.equal(
      ['tag', 'bracket', undefined, 'bracket']
    )
    expect(_state.marks.length).to.equal(0)
    expect(parseLine('\\titlestyle{foo}')).to.deep.equal(
      ['tag', 'bracket', undefined, 'bracket']
    )
    expect(_state.marks.length).to.equal(0)
  })

  it('matches \\section with space between command and arg', function () {
    expect(parseLine('\\section {foo}')).to.deep.equal(
      ['tag', 'bracket', undefined, 'bracket']
    )
    expect(_state.marks.length).to.equal(1)
    expect(_state.marks[0].kind).to.equal('section')
    expect(_state.marks[0].from).to.deep.equal(pos(0, 0))
    expect(_state.marks[0].contentFrom).to.deep.equal(pos(0, 10))
    expect(_state.marks[0].contentTo).to.deep.equal(pos(0, 13))
    expect(_state.marks[0].to).to.deep.equal(pos(0, 14))
  })

  it('matches section* commands', function () {
    expect(parseLine('\\section*{foo}')).to.deep.equal(
      ['tag', 'bracket', undefined, 'bracket']
    )
    expect(_state.marks.length).to.equal(1)
    expect(_state.marks[0].kind).to.equal('section\\*')
    expect(_state.marks[0].from).to.deep.equal(pos(0, 0))
    expect(_state.marks[0].contentFrom).to.deep.equal(pos(0, 10))
    expect(_state.marks[0].contentTo).to.deep.equal(pos(0, 13))
    expect(_state.marks[0].to).to.deep.equal(pos(0, 14))
  })

  it('handles a trailing space in math mode', function () {
    // regression: this was incorrectly picking up the trailing space as a blank
    // line and abandoning the mark
    parseLine('$')
    parseLine('x ')
    parseLine('$')
    expect(_state.openMarks.length).to.equal(0)
    expect(_state.marks.length).to.equal(1)
  })

  it('abandons nested marks', function () {
    parseLine('\\textit{\\begin{equation}')
    parseLine('')
    parseLine('\\end{equation}}')
    expect(_state.openMarks.length).to.equal(0)
    expect(_state.marks.length).to.equal(0)
  })

  it('marks short abstract', function () {
    parseLine('\\begin{abstract}')
    parseLine('test')
    parseLine('\\end{abstract}')
    expect(_state.openMarks.length).to.equal(0)
    expect(_state.marks.length).to.equal(1)
  })

  it('marks long abstract', function () {
    parseLine('\\begin{abstract}')
    parseLine('test')
    parseLine('')
    parseLine('test')
    parseLine('\\end{abstract}')
    expect(_state.openMarks.length).to.equal(0)
    expect(_state.marks.length).to.equal(1)
  })

  it('marks math in abstract', function () {
    parseLine('\\begin{abstract}')
    parseLine('test $x$ test')
    parseLine('test')
    parseLine('\\end{abstract}')
    expect(_state.openMarks.length).to.equal(0)
    expect(_state.marks.length).to.equal(2)
  })

  it('marks a number in math', function () {
    expect(parseLine('$1024.00$')).to.deep.equal(
      ['keyword', 'number', 'keyword']
    )
  })

  it('marks everything after end as comment', function () {
    parseLine('\\end{document}')
    expect(parseLine('\\textbf{abc}')).to.deep.equal(['comment'])
  })

  it('marks verbatim command correctly', function () {
    expect(parseLine('\\verb+my text akfdnakfnaf')).to.deep.equal(
      ['tag', 'string']
    )
    expect(_state.openMarks.length).to.equal(0)
    expect(parseLine('something else+null')).to.deep.equal(
      ['string', 'tag', undefined]
    )
    expect(_state.marks.length).to.equal(0)
  })

  it('marks verbatim env', function () {
    expect(parseLine('\\begin{verbatim}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('abc')).to.deep.equal(['string'])
    expect(parseLine('\\textbf{}')).to.deep.equal(['string', 'string'])
    expect(_state.openMarks.length).to.equal(0)
    expect(parseLine('\\end{verbatim}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(_state.marks.length).to.equal(0)
  })

  it('marks tikzpicture env', function () {
    expect(parseLine('\\begin{tikzpicture}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(_state.openMarks.length).to.equal(0)
    expect(parseLine('\\othercommand{test}')).to.deep.equal(
      ['tag', 'bracket', undefined, 'bracket']
    )
    expect(parseLine('\\end{tikzpicture}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(_state.marks.length).to.equal(0)
  })

  it('marks begin keywords inside an equation', function () {
    expect(parseLine('\\begin{equation}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('\\begin{array}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('\\end{array}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
    expect(parseLine('\\end{equation}')).to.deep.equal(
      ['tag', 'bracket', 'keyword', 'bracket']
    )
  })
})

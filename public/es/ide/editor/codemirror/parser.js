import CodeMirror from 'codemirror'

import Mark from './mark'

//
// if we consume a token, we have to return immediately, so we have to shift
// whatever we want to do next onto the stack
//
// if we can't match a token with the mode on the top of the stack, we should
// retry with the next one down; the _topLevel mode is guaranteed to match at
// least one token, so the stack never empties
//
// two kinds of methods:
// match*:
//  - call stream.match with some input that we're looking for (e.g. a command)
//  - if it matches, we now have to return a style to codemirror, but we want to
//    remember that we've seen this command, because it affects what we look for
//    the next time the mode is called; so, we push a new tokenize method onto
//    the stack
//  - if it doesn't match, we consume no input and return something falsey; note
//    that this means a match method cannot be used to return a null/undefined
//    style to codemirror, but that hasn't been an issue so far, because we're
//    usually matching something we want to highlight
//
// push*:
//  - without looking at the input stream, push a tokenizer method onto the
//    stack
//  - the tokenizer method tries to match input from the stream when it gets
//    called, later on
//  - if it matches, it has to return, and it should pop itself off the stack;
//    it may push something else onto the stack after it does this
//  - if it doesn't match, it just pops itself off the stack, and we try the
//    next method in the stack
//
// TODOs
//  - ${$ and $}$ are invalid, but ${}$ is valid; we can't use 'abandon' to
//  filter out both { and }, but maybe we could use it to filter }, because we
//  should always be in a higher mode when looking for }.
//
// Mode State:
// -----------
//
// The mode state is what allows CodeMirror to resume parsing from the last
// point of change, instead of parsing the whole document every time there is a
// change. CodeMirror copies the state at the end of each line; it copies
// arrays, but it does NOT do a deep copy; we currently treat everything in the
// mode state as immutable. We could instead implement our own copyState
// function, but immutability seems cleaner.
//
// The state for this mode has the following members:
//
// 1. stack: a stack of tokenizer functions; each one has the same signature as
//           the mode's token method: token(stream, state); the tokenizer must
//           return a token style if it consumes any input.
//
// 2. line: the line number of the current position; we need to know this in
//          order to create the marks; it would be nice if CodeMirror kept track
//          of this for us, but at the time of writing (v3.19), it doesn't
//
// 3. openMarks: a stack of Marks that are still open at the current position
//
// 4. marks: a list of all Marks that have been closed by the current position,
//           in the order in which they were closed
//
export default function LatexMode() {
  //
  // Stack: we maintain the parse state as a stack of tokenize functions.
  //
  function _push(state, tokenizer) {
    state.stack.push(tokenizer);
  }

  function _pop(state) {
    state.stack.pop();
  }

  function _popAndResume(stream, state) {
    _pop(state);
    return state.stack[state.stack.length - 1](stream, state);
  }

  function _defer(state, tokenizer) {
    _push(state, function (stream, state) {
      _pop(state);
      return tokenizer(stream, state);
    });
  }

  /**
   * Match a sequence of patterns with the matching sequence of tokens and then
   * resume parsing with the given tokenizer. This is a convenient way to
   * nest multiple calls to _defer when there is nothing special to be done on
   * each individual pattern.
   *
   * NB this method is typically called only after first establishing that all
   * of the patterns will in fact match, using a lookahead match.
   *
   * @param {Array} patterns not empty
   *
   * @param {Array} tokens same length as patterns
   *
   * @param {Function} callback return value is ignored, because it is called
   * just after we have processed the last token in the sequence; it should
   * set up the stack for the next call
   */
  function _matchSequence(stream, state, patterns, tokens, callback) {
    var i = 0;
    function _matchNext(stream, state) {
      if (stream.match(patterns[i])) {
        var token = tokens[i];
        ++i;
        if (i < patterns.length) {
          _defer(state, _matchNext);
        } else {
          callback(stream, state);
        }
        return token;
      }
    }
    return _matchNext(stream, state);
  }

  /**
   * Match a \begin{env} tag; because the sequence contains several types of
   * tokens, this actually pushes several methods onto the stack;
   * {@see_matchSequence}.
   */
  function _matchBeginEnvironmentSequence(stream, state, callback) {
    return _matchSequence(stream, state,
      [/^\\begin\s*/, '{', /[^{}]+/, '}'],
      ['tag', 'bracket', 'keyword', 'bracket'],
      callback);
  }

  /**
   * Match a \end{env} tag; {@see _matchSequence}.
   */
  function _matchEndEnvironmentSequence(stream, state, callback) {
    return _matchSequence(stream, state,
      [/^\\end\s*/, '{', /[^{}]+/, '}'],
      ['tag', 'bracket', 'keyword', 'bracket'],
      callback);
  }

  //
  // Marks: marks identify a range of source code to be rendered using a
  // CodeMirror TextMarker, and manage the mark stack and list.
  //

  function _startPos(stream, state) {
    return CodeMirror.Pos(state.line, stream.start);
  }

  function _currentPos(stream, state) {
    return CodeMirror.Pos(state.line,
      stream.start + stream.current().length);
  }

  function _openMark(stream, state, kind, openPos) {
    var newMark = new Mark(kind, openPos, _currentPos(stream, state));
    state.openMarks.push(newMark);
    return newMark;
  }

  function _abandonMark(stream, state) {
    state.openMarks.pop();
  }

  function _closeMark(stream, state, closePos) {
    var mark = state.openMarks.pop();
    var openParent = mark.openParent || state.openMarks[state.openMarks.length - 1];
    var newMark = new Mark(mark.kind, mark.from, mark.contentFrom, closePos,
      _currentPos(stream, state), openParent);
    state.marks.push(newMark);
    return newMark;
  }

  /**
   * The last closed mark, if any.
   *
   * @param {Object} state
   *
   * @return {Mark, null}
   */
  function _lastClosedMark(state) {
    return state.marks[state.marks.length - 1];
  }

  function _matchAndMark(stream, state, kind, openPos,
    open, openStyle, close, closeStyle, abandon, innerMode) {
    if (stream.match(open)) {
      _openMark(stream, state, kind, openPos);
      _push(state, function (stream, state) {
        if (_matchBlankLine(stream)) {
          _abandonMark(stream, state);
          return _popAndResume(stream, state);
        }

        // look ahead for tokens that signal that something is wrong and we
        // should abandon the current mark
        for (var i = 0; i < abandon.length; ++i) {
          if (stream.match(abandon[i], false)) {
            _abandonMark(stream, state);
            return _popAndResume(stream, state);
          }
        }

        if (stream.match(close)) {
          _closeMark(stream, state, _startPos(stream, state));
          _pop(state);
          return closeStyle;
        } else {
          return innerMode(stream, state);
        }
      });
      return openStyle;
    }
  }

  function _matchAndMarkOptionalArgument(stream, state,
    kind, openPos, innerMode) {
    return _matchAndMark(stream, state, kind, openPos,
      '[', 'bracket',
      ']', 'bracket',
      [], innerMode);
  }

  function _matchAndMarkRequiredArgument(stream, state,
    kind, openPos, innerMode) {
    return _matchAndMark(stream, state, kind, openPos,
      '{', 'bracket',
      '}', 'bracket',
      [], innerMode);
  }

  //
  // Blank Lines:
  //
  //  - note that codemirror calls the mode's blankLine only for an empty line;
  //    a line with only whitespace behaves like a blank line in TeX
  //  - a blank line should break us out of math mode, because we want to avoid
  //    runaway math environments that eat the whole file.
  //  - a blank line between a command its argument is invalid, so we can also
  //    give up on parsing for arguments when we see a blank line
  //  - however, a blank line does not terminate a verbatim / comment
  //    environment; tikzpicture also permits blank lines
  //
  function _matchBlankLine(stream) {
    return stream.sol() && (stream.eol() || stream.match(/^[\s\u00a0]+$/));
  }

  //
  // Parser
  //
  /**
   * Note: an argument is not allowed to contain a blank line
   */
  function _matchArgument(stream, state,
    open, openStyle, close, closeStyle, innerMode) {
    if (stream.match(open)) {
      _push(state, function (stream, state) {
        if (_matchBlankLine(stream)) {
          _pop(state);
          return;
        } else if (stream.match(close)) {
          _pop(state);
          return closeStyle;
        } else {
          return innerMode(stream, state);
        }
      });
      return openStyle;
    }
  }

  function _matchOptionalArgument(stream, state, innerMode) {
    return _matchArgument(stream, state,
      '[', 'bracket',
      ']', 'bracket',
      innerMode);
  }

  /**
   * Note: a group is allowed to contain a blank line
   */
  function _matchGroup(stream, state, innerMode) {
    if (stream.eat('{')) {
      _push(state, function (stream, state) {
        if (stream.eat('}')) {
          _pop(state);
          return 'bracket';
        } else {
          return innerMode(stream, state);
        }
      });
      return 'bracket';
    }
  }

  /**
   * Called before trying to match any mode-specific rules, to match comments.
   */
  function _matchLineComment(stream, state) {
    if (stream.match(/^\s*%/)) {
      stream.skipToEnd();
      return 'comment';
    }
  }

  /**
   * Note: guaranteed to match input if there is any
   */
  function _matchMath(stream, state) {
    function _matchOtherMath(stream, state) {
      if (stream.match(/^\\(?:[a-zA-Z]+|.|\n)/)) {
        return 'tag'; // command in math mode
      } else if (stream.match(/^[\^_&~]/)) {
        return "tag"; // special math mode character
      } else if (stream.match(/^(?:\d+\.\d*|\d*\.\d+|\d+)/)) {
        return "number";
      } else {
        stream.next();
        return;
      }
    }

    return _matchVerbCommand(stream, state) ||
      _matchOtherEnvironmentBeginOrEnd(stream, state) ||
      _matchOtherCommand(stream, state) ||
      _matchOtherMath(stream, state);
  }

  function _matchTitleCommand(stream, state) {
    if (stream.match(/^\\title[\[{]/, false)) {
      stream.match(/^\\title/);
      // want to capture the full title
      var openPos = _startPos(stream, state);
      _defer(state, function (stream, state) {
        return _matchAndMarkRequiredArgument(stream, state,
          'title', openPos, _matchText);
      });
      // may have a short title as an optional argument, which we ignore
      _defer(state, function (stream, state) {
        return _matchOptionalArgument(stream, state, _matchText);
      });
      return 'tag';
    }
  }

  function _buildCommandPatterns(commands) {
    for (var command in commands) {
      commands[command].lookaheadPattern =
        new RegExp('^\\\\' + command + '\\s*[\\[{]');
      commands[command].matchPattern =
        new RegExp('^\\\\' + command + '\\s*');
    }
    return commands;
  }

  var _commandForPatterns = {
    'author': {},
    'chapter\\*': {},
    'chapter': {},
    'section': {},
    'section\\*': {},
    'subsection': {},
    'subsection\\*': {},
    'subsubsection': {},
    'subsubsection\\*': {},
    'textbf': {},
    'textit': {},
    'caption': {},
    'label': {},
    'includegraphics': {},
    'ref': {},
    'input': {},
    'include': {}
  };

  var _bibCommands = [
    'cite',
    'citep',
    'citet',
    'footcite',
    'nocite',
    'autocite',
    'autocites',
    'citeauthor',
    'citeyear',
    'parencite',
    'citealt',
    'textcite',
    'cref',
    'Cref',
  ]

  _.each(_bibCommands, function (command) {
    _commandForPatterns[command] = {}
  });

  var _MATCH_COMMAND_WITH_ARGUMENT_LOOKAHEADS = _buildCommandPatterns(
    _commandForPatterns
  );

  function _matchCommandWithArgument(stream, state, command) {
    var commandInfo = _MATCH_COMMAND_WITH_ARGUMENT_LOOKAHEADS[command];
    if (stream.match(commandInfo.lookaheadPattern, false)) {
      stream.match(commandInfo.matchPattern);
      var openPos = _startPos(stream, state);
      _defer(state, function (stream, state) {
        return _matchAndMarkRequiredArgument(stream, state,
          command, openPos, _matchText);
      });
      return 'tag';
    }
  }

  function _matchBibCommand(stream, state) {
    var currentVal;
    var returnVal = null;
    _.each(_bibCommands, function (command) {
      currentVal = _matchCommandWithArgument(stream, state, command);
      if (currentVal) {
        returnVal = currentVal;
        return false;
      }
    });
    return returnVal;
  }

  function _matchItemCommand(stream, state) {
    var kind = 'item';
    if (stream.sol() && stream.match(/^\\item(?: |$)/)) {
      var lastOpenmark = state.openMarks[state.openMarks.length - 1];
      if (state.openMarks.length > 0 && lastOpenmark.kind === 'enumerate') {
        kind = 'enumerate-item';
      }
      _openMark(stream, state, kind, _startPos(stream, state));
      var closedMark = _closeMark(stream, state, _currentPos(stream, state));
      closedMark.checkedProperties.kind = kind;
      if (kind === 'enumerate-item' || kind === 'item') {
        closedMark.checkedProperties.number = 1;
        closedMark.checkedProperties.openMarksCount = state.openMarks.length - 1;
        for (var x = state.marks.length - 2; x >= 0; x--) {
          var mark = state.marks[x];
          if (mark.from.line < lastOpenmark.from.line) {
            break;
          }
          if (mark.kind === kind) {
            if (mark.openParent !== lastOpenmark) {
              continue;
            }
            closedMark.checkedProperties.number = mark.checkedProperties.number + 1;
            break;
          }
        }
      }
      return 'tag';
    }
  }

  /**
   * Match a \verb command. This is based on
   * http://www.tex.ac.uk/cgi-bin/texfaq2html?label=verbwithin
   */
  function _matchVerbCommand(stream, state) {
    var verbMatch = stream.match(/^\\verb\*?([^a-zA-Z])/);
    if (verbMatch) {
      var verbEnd = verbMatch[1];
      _push(state, function (stream, state) {
        if (stream.match(verbEnd)) {
          _pop(state);
          return 'tag';
        } else if (stream.skipTo(verbEnd)) {
          return 'string';
        } else {
          stream.skipToEnd();
          return 'string';
        }
      });
      return 'tag';
    }
  }

  function _matchVerbatimEnvironment(stream, state) {
    if (!stream.match(/^[^\\]+/)) {
      stream.next(); // Skip over backslashes so that they don't get parsed
    }
    return 'string';
  }

  function _matchCommentEnvironment(stream, state) {
    if (!stream.match(/^[^\\]+/)) {
      stream.next(); // Skip over backslashes so that they don't get parsed
    }
    return 'comment';
  }

  function _matchTikZ(stream, state) {
    return _matchEnvironments(stream, state, _TIKZ_ENVIRONMENTS) ||
      _matchOtherCommand(stream, state) ||
      _matchOther(stream, state);
  }

  function _matchFigureContent(stream, state) {
    return _matchCommandWithArgument(stream, state, 'caption') ||
      _matchIncludeGraphics(stream, state) ||
      _matchText(stream, state);
  }

  function _matchIncludeGraphics(stream, state) {
    var commandInfo = _MATCH_COMMAND_WITH_ARGUMENT_LOOKAHEADS.includegraphics;
    if (stream.match(commandInfo.lookaheadPattern, false)) {
      stream.match(commandInfo.matchPattern);
      var openPos = _startPos(stream, state);
      _defer(state, function (stream, state) {
        return _matchAndMarkRequiredArgument(stream, state,
          'includegraphics', openPos, _matchText);
      });
      _defer(state, function (stream, state) {
        return _matchAndMarkOptionalArgument(stream, state,
          'includegraphics-optional', openPos, _matchText);
      });
      return 'tag';
    }
  }

  //
  // Environment matching
  //
  // For each environment, we have:
  //
  // tokenizer: function to tokenize with inside of the environment; the
  // _matchEnvironments function calls the tokenizer so long as the environment
  // has not ended
  //
  // kind: if the environment is to be marked, then this is the kind used for
  // the mark; if this is not specified, the environment is matched but not
  // marked.
  //
  // allowBlankLines: some environments, such as equation, are "short" --- they
  // do not allow blank lines. Other environments, such as abstract, are "long"
  // --- they do allow blank lines
  //
  // beginPattern, endPattern: regular expressions used to match the beginning
  // and end of the environment, respectively
  //
  function _buildEnvironmentBeginAndEndPatterns(environments) {
    for (var env in environments) {
      if (environments.hasOwnProperty(env)) {
        var end = environments[env].matchOnSingleLine ? '$' : '';
        environments[env].beginPattern = new RegExp('^\\\\begin\\s*{' + env + '}' + end);
        environments[env].endPattern = new RegExp('^\\\\end\\s*{' + env + '}');
      }
    }
    return environments;
  }

  var _IGNORED_ENVIRONMENTS = _buildEnvironmentBeginAndEndPatterns({
    'verbatim': { tokenizer: _matchVerbatimEnvironment },
    'Verbatim': { tokenizer: _matchVerbatimEnvironment },
    'lstlisting': { tokenizer: _matchVerbatimEnvironment },
    'minted': { tokenizer: _matchVerbatimEnvironment },
    'comment': { tokenizer: _matchCommentEnvironment }
  });
  var env;
  for (env in _IGNORED_ENVIRONMENTS) {
    if (_IGNORED_ENVIRONMENTS.hasOwnProperty(env)) {
      _IGNORED_ENVIRONMENTS[env].allowBlankLines = true;
    }
  }

  var _MATH_ENVIRONMENTS = {
    'math': { kind: 'inline-math' },
    'displaymath': { kind: 'display-math' }
  };
  [ // Standard LaTeX
    'equation',
    'eqnarray',
    // AMS-LaTeX
    'align',
    'gather',
    'multline',
    'alignat',
    'xalignat'
  ].forEach(function (env) {
    _MATH_ENVIRONMENTS[env] = { kind: 'outer-display-math' };
    _MATH_ENVIRONMENTS[env + '\\*'] = { kind: 'outer-display-math' };
  });
  _buildEnvironmentBeginAndEndPatterns(_MATH_ENVIRONMENTS);
  for (env in _MATH_ENVIRONMENTS) {
    if (_MATH_ENVIRONMENTS.hasOwnProperty(env)) {
      _MATH_ENVIRONMENTS[env].tokenizer = _matchMath;
      _MATH_ENVIRONMENTS[env].allowBlankLines = false;
    }
  }

  var _TOP_LEVEL_ENVIRONMENTS = _buildEnvironmentBeginAndEndPatterns({
    'abstract': { tokenizer: _matchText, kind: 'abstract', allowBlankLines: true }
  });

  var _LIST_ENVIROMENTS = _buildEnvironmentBeginAndEndPatterns({
    'itemize': { tokenizer: _matchListContent, kind: 'itemize', allowBlankLines: true, matchOnSingleLine: true },
    'enumerate': { tokenizer: _matchListContent, kind: 'enumerate', allowBlankLines: true, matchOnSingleLine: true }
  });

  var _FIGURE_ENVIRONMENTS = _buildEnvironmentBeginAndEndPatterns({
    'figure': { tokenizer: _matchFigureContent, kind: 'figure', allowBlankLines: true }
  });

  var _TIKZ_ENVIRONMENTS = _buildEnvironmentBeginAndEndPatterns({
    'tikzpicture': { tokenizer: _matchTikZ, allowBlankLines: true }
  });

  function _lookaheadForBeginEnvironments(
    stream, state, environments, matcher) {
    for (var env in environments) {
      if (environments.hasOwnProperty(env)) {
        var envConfig = environments[env];
        if (stream.match(envConfig.beginPattern, false)) {
          return matcher(stream, state, envConfig);
        }
      }
    }
  }

  function _matchEnvironments(stream, state, environments) {
    return _lookaheadForBeginEnvironments(
      stream, state, environments,
      function (stream, state, envConfig) {
        var mark = envConfig.hasOwnProperty('kind'), markOpenPos, markClosePos;

        if (mark) {
          markOpenPos = _startPos(stream, state);
        }

        return _matchBeginEnvironmentSequence(
          stream, state, function (stream, state) {
            if (mark) {
              var openMark = _openMark(stream, state, envConfig.kind, markOpenPos);
              openMark.checkedProperties.openMarksCount = state.openMarks.length - 1;
            }
            _push(state, _matchEnvironment);
          });

        function _matchEnvironment(stream, state) {
          if (!envConfig.allowBlankLines && _matchBlankLine(stream)) {
            if (mark) {
              _abandonMark(stream, state);
            }
            return _popAndResume(stream, state);
          } else if (stream.match(envConfig.endPattern, false)) {
            if (mark) {
              markClosePos = _startPos(stream, state);
            }
            _pop(state);
            return _matchEndEnvironmentSequence(
              stream, state, function (stream, state) {
                if (mark) {
                  var closedMark = _closeMark(stream, state, markClosePos);
                  closedMark.checkedProperties.openMarksCount = state.openMarks.length;
                  closedMark.checkedProperties.fromLine = closedMark.from.line;
                  closedMark.checkedProperties.toLine = closedMark.to.line;
                }
              });
          } else {
            return envConfig.tokenizer(stream, state);
          }
        }
      });
  }

  function _matchCommand(stream, state, command, markKind) {
    if (stream.match(command)) {
      var openPos = _startPos(stream, state);
      _openMark(stream, state, markKind, openPos);
      _closeMark(stream, state, openPos);
      return 'tag';
    }
  }

  function _matchOtherEnvironmentBeginOrEnd(stream, state) {
    if (stream.match(/^\\begin\s*{[^}]+}/, false)) {
      return _matchBeginEnvironmentSequence(stream, state, function () { });
    } else if (stream.match(/^\\end\s*{[^}]+}/, false)) {
      return _matchEndEnvironmentSequence(stream, state, function () { });
    }
  }

  function _matchOtherCommand(stream, state) {
    if (stream.match(/^\\(?:[a-zA-Z]+|.|\n)/)) {
      return 'tag';
    }
  }

  function _matchSectioningCommand(stream, state) {
    return _matchCommandWithArgument(stream, state, 'chapter') ||
      _matchCommandWithArgument(stream, state, 'chapter\\*') ||
      _matchCommandWithArgument(stream, state, 'section') ||
      _matchCommandWithArgument(stream, state, 'section\\*') ||
      _matchCommandWithArgument(stream, state, 'subsection') ||
      _matchCommandWithArgument(stream, state, 'subsection\\*') ||
      _matchCommandWithArgument(stream, state, 'subsubsection') ||
      _matchCommandWithArgument(stream, state, 'subsubsection\\*');
  }

  function _matchListContent(stream, state) {
    return _matchItemCommand(stream, state) || _matchText(stream, state);
  }

  function _matchDollarDollarMath(stream, state) {
    return _matchAndMark(stream, state, 'display-math',
      _startPos(stream, state),
      '$$', 'keyword',  // open
      '$$', 'keyword',  // close
      [],               // abandon
      _matchMath);
  }

  function _matchDollarMath(stream, state) {
    return _matchAndMark(stream, state, 'inline-math',
      _startPos(stream, state),
      '$', 'keyword',   // open
      '$', 'keyword',   // close
      ['$$'],           // abandon
      _matchMath);
  }

  function _matchBracketMath(stream, state) {
    return _matchAndMark(stream, state, 'display-math',
      _startPos(stream, state),
      '\\[', 'keyword',  // open
      '\\]', 'keyword',  // close
      [],                // abandon
      _matchMath);
  }

  function _matchParenMath(stream, state) {
    return _matchAndMark(stream, state, 'inline-math',
      _startPos(stream, state),
      '\\(', 'keyword',  // open
      '\\)', 'keyword',  // close
      [],                // abandon
      _matchMath);
  }

  /**
   * Everything after an \end{document} tag is treated as a comment.
   */
  function _matchEndDocument(stream, state) {
    if (stream.match(/^\\end\s*{document}/, false)) {
      return _matchEndEnvironmentSequence(stream, state,
        function (stream, state) {
          _push(state, function (stream, state) {
            stream.skipToEnd();
            return 'comment';
          });
        });
    }
  }

  /**
   *
   */
  function _matchOther(stream) {
    if (stream.match(/^[{}\[\]]/)) {
      return 'bracket';
    } else if (stream.match(/^[&~]+/)) {
      return 'tag';
    } else if (stream.match(/^[^{}\[\]\\$&%~]+/)) {
      // nothing to do
    } else {
      stream.next();
    }
  }

  /**
   * Text mode.
   */
  function _matchText(stream, state) {
    return _matchCommandWithArgument(stream, state, 'textbf') ||
      _matchCommandWithArgument(stream, state, 'textit') ||
      _matchBracketMath(stream, state) ||
      _matchParenMath(stream, state) ||
      _matchCommandWithArgument(stream, state, 'ref') ||
      _matchBibCommand(stream, state) ||
      _matchCommandWithArgument(stream, state, 'label') ||
      _matchCommandWithArgument(stream, state, 'input') ||
      _matchCommandWithArgument(stream, state, 'include') ||
      _matchEnvironments(stream, state, _FIGURE_ENVIRONMENTS) ||
      _matchEnvironments(stream, state, _LIST_ENVIROMENTS) ||
      _matchEnvironments(stream, state, _MATH_ENVIRONMENTS) ||
      _matchVerbCommand(stream, state) ||
      _matchEnvironments(stream, state, _IGNORED_ENVIRONMENTS) ||
      _matchEnvironments(stream, state, _TIKZ_ENVIRONMENTS) ||
      _matchOtherEnvironmentBeginOrEnd(stream, state) ||
      _matchOtherCommand(stream, state) ||
      _matchGroup(stream, state, _matchText) ||
      _matchDollarDollarMath(stream, state) ||
      _matchDollarMath(stream, state) ||
      _matchOther(stream);
  }

  /**
   * Document top-level.
   */
  function _topLevel(stream, state) {
    return _matchTitleCommand(stream, state) ||
      _matchCommandWithArgument(stream, state, 'author') ||
      _matchCommand(stream, state, /^\\maketitle$/, 'maketitle') ||
      _matchSectioningCommand(stream, state) ||
      _matchEnvironments(stream, state, _TOP_LEVEL_ENVIRONMENTS) ||
      _matchEndDocument(stream, state) ||
      _matchText(stream, state);
  }

  function _startNewLine(state) {
    state.line += 1;
  }

  function _token(stream, state) {
    if (stream.sol()) {
      _startNewLine(state);
    }

    var result = _matchLineComment(stream, state);
    if (!result) {
      var mode = state.stack[state.stack.length - 1];
      if (mode) {
        result = mode(stream, state);
      } else {
        throw 'empty stack';
      }
    }

    // if we are still at the start of the line, we'll get called again, so we
    // don't want to increment the line number; this should not happen, because
    // we should always consume at least one token when called, but it isn't
    // necessarily a bad thing if we don't, so we handle this case here
    if (stream.sol() && !stream.eol()) {
      state.line -= 1;
    }

    return result;
  }

  this.startState = function () {
    //console.clear();
    return {
      stack: [_topLevel],
      line: -1,
      openMarks: [],
      marks: []
    };
  };
  this.blankLine = function (state) {
    _token(new CodeMirror.StringStream(""), state);
  };
  this.token = _token;
  this.lineComment = "%";
};

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
WL.LatexMode.Mark = function (kind, from, contentFrom, contentTo, to, openParent) {
  this.kind = kind;
  this.from = from;
  this.to = to;
  this.contentFrom = contentFrom;
  this.contentTo = contentTo;
  this.openParent = openParent;
  this.checkedProperties = {};
};

/**
 * New shallow copy of an existing mark. Note: this copies only the standard
 * properties used in the constructor.
 *
 * @param {Mark} mark
 *
 * @return {Mark}
 */
WL.LatexMode.Mark.copy = function (mark) {
  return new WL.LatexMode.Mark(
    mark.kind, mark.from, mark.contentFrom, mark.contentTo, mark.to, mark.openParent);
};

CodeMirror.defineMode('latex', function (config, parseConfig) {
  return new WL.LatexMode();
});
CodeMirror.defineMIME("application/x-tex", "latex");
CodeMirror.defineMIME("application/x-latex", "latex");

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { commonPrefixLength, commonSuffixLength } from 'vs/base/common/strings';
import { Range } from 'vs/editor/common/core/range';
import { EndOfLinePreference } from 'vs/editor/common/editorCommon';
import { Constants } from 'vs/editor/common/core/uint';

export interface ITextAreaWrapper {
	getValue(): string;
	setValue(reason: string, value: string): void;

	getSelectionStart(): number;
	getSelectionEnd(): number;
	setSelectionRange(selectionStart: number, selectionEnd: number): void;
}

export interface ISimpleModel {
	getLineCount(): number;
	getLineMaxColumn(lineNumber: number): number;
	getValueInRange(range: Range, eol: EndOfLinePreference): string;
}

export interface ITypeData {
	text: string;
	replaceCharCnt: number;
}

export class TextAreaState {

	public static EMPTY = new TextAreaState('', 0, 0, 0);

	public readonly value: string;
	public readonly selectionStart: number;
	public readonly selectionEnd: number;
	public readonly selectionToken: number;

	constructor(value: string, selectionStart: number, selectionEnd: number, selectionToken: number) {
		this.value = value;
		this.selectionStart = selectionStart;
		this.selectionEnd = selectionEnd;
		this.selectionToken = selectionToken;
	}

	public equals(other: TextAreaState): boolean {
		if (other instanceof TextAreaState) {
			return (
				this.value === other.value
				&& this.selectionStart === other.selectionStart
				&& this.selectionEnd === other.selectionEnd
				&& this.selectionToken === other.selectionToken
			);
		}
		return false;
	}

	public toString(): string {
		return '[ <' + this.value + '>, selectionStart: ' + this.selectionStart + ', selectionEnd: ' + this.selectionEnd + ', selectionToken: ' + this.selectionToken + ']';
	}

	public readFromTextArea(textArea: ITextAreaWrapper): TextAreaState {
		return new TextAreaState(textArea.getValue(), textArea.getSelectionStart(), textArea.getSelectionEnd(), this.selectionToken);
	}

	public collapseSelection(): TextAreaState {
		return new TextAreaState(this.value, this.value.length, this.value.length, this.selectionToken);
	}

	public writeToTextArea(reason: string, textArea: ITextAreaWrapper, select: boolean): void {
		// console.log(Date.now() + ': applyToTextArea ' + reason + ': ' + this.toString());
		textArea.setValue(reason, this.value);
		if (select) {
			textArea.setSelectionRange(this.selectionStart, this.selectionEnd);
		}
	}

	public static selectedText(text: string): TextAreaState {
		return new TextAreaState(text, 0, text.length, 0);
	}

	public static deduceInput(previousState: TextAreaState, currentState: TextAreaState): ITypeData {
		if (!previousState) {
			// This is the EMPTY state
			return {
				text: '',
				replaceCharCnt: 0
			};
		}

		// console.log('------------------------deduceInput');
		// console.log('CURRENT STATE: ' + currentState.toString());
		// console.log('PREVIOUS STATE: ' + prevState.toString());

		let previousValue = previousState.value;
		let previousSelectionStart = previousState.selectionStart;
		let previousSelectionEnd = previousState.selectionEnd;
		let currentValue = currentState.value;
		let currentSelectionStart = currentState.selectionStart;
		let currentSelectionEnd = currentState.selectionEnd;

		// Strip the previous suffix from the value (without interfering with the current selection)
		let previousSuffix = previousValue.substring(previousSelectionEnd);
		let currentSuffix = currentValue.substring(currentSelectionEnd);
		let suffixLength = commonSuffixLength(previousSuffix, currentSuffix);
		currentValue = currentValue.substring(0, currentValue.length - suffixLength);
		previousValue = previousValue.substring(0, previousValue.length - suffixLength);

		let previousPrefix = previousValue.substring(0, previousSelectionStart);
		let currentPrefix = currentValue.substring(0, currentSelectionStart);
		let prefixLength = commonPrefixLength(previousPrefix, currentPrefix);
		currentValue = currentValue.substring(prefixLength);
		previousValue = previousValue.substring(prefixLength);
		currentSelectionStart -= prefixLength;
		previousSelectionStart -= prefixLength;
		currentSelectionEnd -= prefixLength;
		previousSelectionEnd -= prefixLength;

		// console.log('AFTER DIFFING CURRENT STATE: <' + currentValue + '>, selectionStart: ' + currentSelectionStart + ', selectionEnd: ' + currentSelectionEnd);
		// console.log('AFTER DIFFING PREVIOUS STATE: <' + previousValue + '>, selectionStart: ' + previousSelectionStart + ', selectionEnd: ' + previousSelectionEnd);

		if (currentSelectionStart === currentSelectionEnd) {
			// composition accept case
			// [blahblah] => blahblah|
			if (
				previousValue === currentValue
				&& previousSelectionStart === 0
				&& previousSelectionEnd === previousValue.length
				&& currentSelectionStart === currentValue.length
				&& currentValue.indexOf('\n') === -1
			) {
				return {
					text: '',
					replaceCharCnt: 0
				};
			}

			// no current selection
			let replacePreviousCharacters = (previousPrefix.length - prefixLength);
			// console.log('REMOVE PREVIOUS: ' + (previousPrefix.length - prefixLength) + ' chars');

			return {
				text: currentValue,
				replaceCharCnt: replacePreviousCharacters
			};
		}

		// there is a current selection => composition case
		let replacePreviousCharacters = previousSelectionEnd - previousSelectionStart;
		return {
			text: currentValue,
			replaceCharCnt: replacePreviousCharacters
		};
	}
}

export class IENarratorStrategy {

	public static fromEditorSelection(previousState: TextAreaState, model: ISimpleModel, selection: Range): TextAreaState {
		let LIMIT_CHARS = 100;
		let PADDING_LINES_COUNT = 0;

		let selectionStartLineNumber = selection.startLineNumber,
			selectionStartColumn = selection.startColumn,
			selectionEndLineNumber = selection.endLineNumber,
			selectionEndColumn = selection.endColumn,
			selectionEndLineNumberMaxColumn = model.getLineMaxColumn(selectionEndLineNumber);

		// If the selection is empty and we have switched line numbers, expand selection to full line (helps Narrator trigger a full line read)
		if (selection.isEmpty() && previousState && previousState.selectionToken !== selectionStartLineNumber) {
			selectionStartColumn = 1;
			selectionEndColumn = selectionEndLineNumberMaxColumn;
		}

		// `pretext` contains the text before the selection
		let pretext = '';
		let startLineNumber = Math.max(1, selectionStartLineNumber - PADDING_LINES_COUNT);
		if (startLineNumber < selectionStartLineNumber) {
			pretext = model.getValueInRange(new Range(startLineNumber, 1, selectionStartLineNumber, 1), EndOfLinePreference.LF);
		}
		pretext += model.getValueInRange(new Range(selectionStartLineNumber, 1, selectionStartLineNumber, selectionStartColumn), EndOfLinePreference.LF);
		if (pretext.length > LIMIT_CHARS) {
			pretext = pretext.substring(pretext.length - LIMIT_CHARS, pretext.length);
		}


		// `posttext` contains the text after the selection
		let posttext = '';
		let endLineNumber = Math.min(selectionEndLineNumber + PADDING_LINES_COUNT, model.getLineCount());
		posttext += model.getValueInRange(new Range(selectionEndLineNumber, selectionEndColumn, selectionEndLineNumber, selectionEndLineNumberMaxColumn), EndOfLinePreference.LF);
		if (endLineNumber > selectionEndLineNumber) {
			posttext = '\n' + model.getValueInRange(new Range(selectionEndLineNumber + 1, 1, endLineNumber, model.getLineMaxColumn(endLineNumber)), EndOfLinePreference.LF);
		}
		if (posttext.length > LIMIT_CHARS) {
			posttext = posttext.substring(0, LIMIT_CHARS);
		}


		// `text` contains the text of the selection
		let text = model.getValueInRange(new Range(selectionStartLineNumber, selectionStartColumn, selectionEndLineNumber, selectionEndColumn), EndOfLinePreference.LF);
		if (text.length > 2 * LIMIT_CHARS) {
			text = text.substring(0, LIMIT_CHARS) + String.fromCharCode(8230) + text.substring(text.length - LIMIT_CHARS, text.length);
		}

		return new TextAreaState(pretext + text + posttext, pretext.length, pretext.length + text.length, selectionStartLineNumber);
	}
}

export class NVDAPagedStrategy {
	private static _LINES_PER_PAGE = 10;

	private static _getPageOfLine(lineNumber: number): number {
		return Math.floor((lineNumber - 1) / NVDAPagedStrategy._LINES_PER_PAGE);
	}

	private static _getRangeForPage(page: number): Range {
		let offset = page * NVDAPagedStrategy._LINES_PER_PAGE;
		let startLineNumber = offset + 1;
		let endLineNumber = offset + NVDAPagedStrategy._LINES_PER_PAGE;
		return new Range(startLineNumber, 1, endLineNumber, Constants.MAX_SAFE_SMALL_INTEGER);
	}

	public static fromEditorSelection(previousState: TextAreaState, model: ISimpleModel, selection: Range): TextAreaState {

		let selectionStartPage = NVDAPagedStrategy._getPageOfLine(selection.startLineNumber);
		let selectionStartPageRange = NVDAPagedStrategy._getRangeForPage(selectionStartPage);

		let selectionEndPage = NVDAPagedStrategy._getPageOfLine(selection.endLineNumber);
		let selectionEndPageRange = NVDAPagedStrategy._getRangeForPage(selectionEndPage);

		let pretextRange = selectionStartPageRange.intersectRanges(new Range(1, 1, selection.startLineNumber, selection.startColumn));
		let pretext = model.getValueInRange(pretextRange, EndOfLinePreference.LF);

		let lastLine = model.getLineCount();
		let lastLineMaxColumn = model.getLineMaxColumn(lastLine);
		let posttextRange = selectionEndPageRange.intersectRanges(new Range(selection.endLineNumber, selection.endColumn, lastLine, lastLineMaxColumn));
		let posttext = model.getValueInRange(posttextRange, EndOfLinePreference.LF);

		let text: string = null;
		if (selectionStartPage === selectionEndPage || selectionStartPage + 1 === selectionEndPage) {
			// take full selection
			text = model.getValueInRange(selection, EndOfLinePreference.LF);
		} else {
			let selectionRange1 = selectionStartPageRange.intersectRanges(selection);
			let selectionRange2 = selectionEndPageRange.intersectRanges(selection);
			text = (
				model.getValueInRange(selectionRange1, EndOfLinePreference.LF)
				+ String.fromCharCode(8230)
				+ model.getValueInRange(selectionRange2, EndOfLinePreference.LF)
			);
		}

		// Chromium handles very poorly text even of a few thousand chars
		// Cut text to avoid stalling the entire UI
		const LIMIT_CHARS = 500;
		if (pretext.length > LIMIT_CHARS) {
			pretext = pretext.substring(pretext.length - LIMIT_CHARS, pretext.length);
		}
		if (posttext.length > LIMIT_CHARS) {
			posttext = posttext.substring(0, LIMIT_CHARS);
		}
		if (text.length > 2 * LIMIT_CHARS) {
			text = text.substring(0, LIMIT_CHARS) + String.fromCharCode(8230) + text.substring(text.length - LIMIT_CHARS, text.length);
		}

		return new TextAreaState(pretext + text + posttext, pretext.length, pretext.length + text.length, selection.startLineNumber);
	}
}

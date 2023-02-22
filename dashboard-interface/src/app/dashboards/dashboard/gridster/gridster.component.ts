import {
	Component, OnInit, AfterViewInit, OnDestroy, ElementRef, ViewChild, NgZone,
	Input, Output, EventEmitter, ChangeDetectionStrategy, HostListener, HostBinding
} from '@angular/core';
import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import 'rxjs/add/operator/takeUntil';
import 'rxjs/add/observable/fromEvent';

import { GridsterService } from './gridster.service';
import { IGridsterOptions } from './IGridsterOptions';
import { IGridsterDraggableOptions } from './IGridsterDraggableOptions';
import { GridsterPrototypeService } from './gridster-prototype/gridster-prototype.service';
import { GridsterItemPrototypeDirective } from './gridster-prototype/gridster-item-prototype.directive';
import { GridListItem } from './gridList/GridListItem';
import { GridsterOptions } from './GridsterOptions';


@Component({
	selector: 'gridster',
	template:
	`<div class="gridster-container">
		<ng-content></ng-content>
		<div class="position-highlight" style="display:none;" #positionHighlight>
		<div class="inner"></div>
		</div>
	</div>`,
	styleUrls: ['./gridster.component.scss'],
	providers: [ GridsterService ],
	changeDetection: ChangeDetectionStrategy.OnPush
})

export class GridsterComponent implements OnInit, AfterViewInit, OnDestroy {
	@Input() options: IGridsterOptions;
	@Output() optionsChange = new EventEmitter<any>();
	@Input() draggableOptions: IGridsterDraggableOptions;
	@ViewChild('positionHighlight') $positionHighlight;

	@HostBinding('class.gridster--dragging') isDragging = false;
	@HostBinding('class.gridster--resizing') isResizing = false;

	gridster: GridsterService;
	$element: HTMLElement;

	gridsterOptions: GridsterOptions;
	private subscribtions: Array<Subscription> = [];

	constructor(
		private zone: NgZone,
		elementRef: ElementRef,
		gridster: GridsterService,
		private gridsterPrototype: GridsterPrototypeService
	) {
		this.gridster = gridster;
		this.$element = elementRef.nativeElement;
	}

	ngOnInit() {
		this.gridsterOptions = new GridsterOptions(this.options);

		if (this.options.useCSSTransforms) {
			this.$element.classList.add('css-transform');
		}

		this.gridsterOptions.change
			.do((options) => {
				this.gridster.options = options;
				if (this.gridster.gridList) {
					this.gridster.gridList.options = options;
				}
			})
			.do((options) => {
				this.optionsChange.emit(options);
			})
			.subscribe();

		this.gridster.init(this.gridster.options, this.draggableOptions, this);

		Observable.fromEvent(window, 'resize')
			.debounceTime(this.gridster.options.responsiveDebounce || 0)
			.subscribe(() => {
				if (this.gridster.options.responsiveView) {
					this.reload();
				}
			});

		this.zone.runOutsideAngular(() => {
			const scrollSub = Observable.fromEvent(document, 'scroll', true)
				.subscribe(() => this.updateGridsterElementData());
			this.subscribtions.push(scrollSub);
		});
	}

	ngAfterViewInit() {
		this.gridster.start();
		this.updateGridsterElementData();
		this.connectGridsterPrototype();
		this.gridster.$positionHighlight = this.$positionHighlight.nativeElement;
	}

	ngOnDestroy() {
		this.subscribtions.forEach((sub: Subscription) => {
			sub.unsubscribe();
		});
	}

	/**
	 * Change gridster config option and rebuild
	 * @param {string} name
	 * @param {any} value
	 * @return {GridsterComponent}
	 */
	setOption(name: string, value: any) {
		if (name === 'dragAndDrop') {
			if (value) {
				this.enableDraggable();
			} else {
				this.disableDraggable();
			}
		}
		if (name === 'resizable') {
			if (value) {
				this.enableResizable();
			} else {
				this.disableResizable();
			}
		}
		if (name === 'lanes') {
			this.gridster.options.lanes = value;

			this.gridster.gridList.fixItemsPositions(this.gridster.options);
			this.gridster.reflow();
		}
		if (name === 'direction') {
			this.gridster.options.direction = value;
			this.gridster.gridList.pullItemsToLeft();
		}
		if (name === 'widthHeightRatio') {
			this.gridster.options.widthHeightRatio = parseFloat(value || 1);
		}
		if (name === 'responsiveView') {
			this.gridster.options.responsiveView = !!value;
		}
		this.gridster.gridList.setOption(name, value);

		return this;
	}

	reload() {
		setTimeout(() => {
			this.gridster.fixItemsPositions();
			this.gridster.reflow();
		});

		return this;
	}

	updateGridsterElementData() {
		this.gridster.gridsterScrollData = this.getScrollPositionFromParents(this.$element);
		this.gridster.gridsterRect = this.$element.getBoundingClientRect();
	}

	private getScrollPositionFromParents(element: Element, data = {scrollTop: 0, scrollLeft: 0}): {scrollTop: number, scrollLeft: number} {

		if (element.parentElement !== document.body) {
			data.scrollTop += element.parentElement.scrollTop;
			data.scrollLeft += element.parentElement.scrollLeft;

			return this.getScrollPositionFromParents(element.parentElement, data);
		}

		return {
			scrollTop: data.scrollTop,
			scrollLeft: data.scrollLeft
		};
	}

	/**
	 * Connect gridster prototype item to gridster dragging hooks (onStart, onDrag, onStop).
	 */
	private connectGridsterPrototype() {
		let isEntered = false;

		this.gridsterPrototype.observeDropOut(this.gridster)
			.subscribe();

		const dropOverObservable = this.gridsterPrototype.observeDropOver(this.gridster)
			.publish();

		this.gridsterPrototype.observeDragOver(this.gridster).dragOver
			.subscribe((prototype: GridsterItemPrototypeDirective) => {
				if (!isEntered) {
					return;
				}
				this.gridster.onDrag(prototype.item);
			});

		this.gridsterPrototype.observeDragOver(this.gridster).dragEnter
			.subscribe((prototype: GridsterItemPrototypeDirective) => {
				isEntered = true;

				this.gridster.items.push(prototype.item);
				this.gridster.onStart(prototype.item);
			});

		this.gridsterPrototype.observeDragOver(this.gridster).dragOut
			.subscribe((prototype: GridsterItemPrototypeDirective) => {
				if (!isEntered) {
					return;
				}
				this.gridster.onDragOut(prototype.item);
				isEntered = false;
			});

		dropOverObservable
			.subscribe((prototype: GridsterItemPrototypeDirective) => {
				if (!isEntered) {
					return;
				}
				this.gridster.onStop(prototype.item);

				const idx = this.gridster.items.indexOf(prototype.item);
				this.gridster.items.splice(idx, 1);

				isEntered = false;
			});

		dropOverObservable.connect();
	}

	private enableDraggable() {
		this.gridster.options.dragAndDrop = true;

		this.gridster.items
			.filter(item => item.itemComponent)
			.forEach((item: GridListItem) => item.itemComponent.enableDragDrop());
	}

	private disableDraggable() {
		this.gridster.options.dragAndDrop = false;

		this.gridster.items
			.filter(item => item.itemComponent)
			.forEach((item: GridListItem) => item.itemComponent.disableDraggable());
	}

	private enableResizable() {
		this.gridster.options.resizable = true;

		this.gridster.items.forEach((item: GridListItem) => item.itemComponent.enableResizable());
	}

	private disableResizable() {
		this.gridster.options.resizable = false;

		this.gridster.items.forEach((item: GridListItem) => item.itemComponent.disableResizable());
	}
}

import 'hammerjs';
import {Component, HostListener, NgZone, OnInit, ViewChild} from '@angular/core';
import {environment} from "../environments/environment";
import {colors} from "./shape/marker-set.model";
import {ShadowCalculatorService} from "./shadow-calculator.service";
import {ShadowShapeSet, ShapesJSON} from "./shape/shadow-shape.model";
import {MatDialog} from "@angular/material";
import {ShapesLoaderDialogComponent} from "./shape/shapes-loader-dialog/shapes-loader-dialog.component";
import {HelpDialogComponent} from "./help-dialog/help-dialog.component";
import {Location} from '@angular/common';
import {timer} from "rxjs/index";
import {debounce} from "rxjs/internal/operators";
import {googleMapObservable$} from "./utils";
import DrawingControlOptions = google.maps.drawing.DrawingControlOptions;
import OverlayType = google.maps.drawing.OverlayType;
import MarkerOptions = google.maps.MarkerOptions;
import DrawingManager = google.maps.drawing.DrawingManager;
import LatLng = google.maps.LatLng;
import Rectangle = google.maps.Rectangle;
import Polygon = google.maps.Polygon;
import {XY} from "./shape/tranformable-point.model";
import {} from '@types/googlemaps';
import {SettingsDialogComponent} from "./settings-dialog/settings-dialog.component";

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  @ViewChild('gmap') gmapElement: any;
  map: google.maps.Map;
  shadowShapesSet: ShadowShapeSet;
  private drawingManager: DrawingManager;
  private initialLatLng: LatLng;


  constructor(private _ngZone: NgZone, private shadowService: ShadowCalculatorService, public dialog: MatDialog, private location: Location) {
    this.calculateInitialLatLng();
  }

  private calculateInitialLatLng() {
    const hash = this.location.path(true);
    if (hash != '') {
      const arr = hash.split("/");
      let lat, lng;
      for (let i = 0; i < hash.length - 1; i++) {
        if (arr[i] === "lat") {
          lat = arr[i + 1];
        } else if (arr[i] === "lng") {
          lng = arr[i + 1];
        }
      }
      if (lat != null && lng != null) {
        this.initialLatLng = new LatLng(lat, lng);
      }
    }
  }

  ngOnInit() {
    let mapProp = {
      center: this.initialLatLng != null ? this.initialLatLng : new google.maps.LatLng(environment.initLat, environment.initLng),
      zoom: 20,
      mapTypeId: google.maps.MapTypeId.SATELLITE,
      rotateControl: false,
      overviewMapControl: false,
      streetViewControl: false
    };
    this.map = new google.maps.Map(this.gmapElement.nativeElement, mapProp);
    this.map.setTilt(0);


    this.shadowService.init(this.map, this._ngZone);
    this.shadowShapesSet = this.shadowService.shadowShapeSet;


    this.initializeDrawingManager();

    google.maps.event.addListener(this.map, "click", () =>
      this._ngZone.run(() => this.shadowService.clearSelection())
    );

    const centerChanged$ = googleMapObservable$(this.map, 'center_changed');
    const boundChanged$ = googleMapObservable$(this.map, 'bounds_changed');

    boundChanged$.subscribe(() => {
      this.shadowService.recalculateSunPosition();
    });
    boundChanged$.pipe(debounce(() => timer(1000))).subscribe(() => {
      const pos = this.map.getCenter();
      this.shadowService.setPosition(pos);
      this.location.replaceState(`#/lat/${pos.lat()}/lng/${pos.lng()}`);
      // this._ngZone.run(() => this.shadowService.recalculateShadows())
    });


    this.shadowService.setPosition(this.map.getCenter());
    this.shadowService.setDay(this.shadowService.getDate());
    this.shadowService.recalculateShadows();
    if (this.initialLatLng === null)
      this.calculateGeolocation();


  }

  private calculateGeolocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        this.map.setCenter(new LatLng(position.coords.latitude, position.coords.longitude));
        console.log("Geolocation: Latitude: " + position.coords.latitude +
          ", Longitude: " + position.coords.longitude);
        this.shadowService.setPosition(this.map.getCenter());
      });
    }
  }

  public get isNight() {
    return !this.shadowService.isDay;
  }

  public get isDuskOrDawn() {
    return this.shadowService.isDuskOrDawn;
  }

  private initializeDrawingManager() {
    const drawingControlOptions: DrawingControlOptions = {
      position: google.maps.ControlPosition.TOP_CENTER,
      drawingModes: [OverlayType.RECTANGLE, OverlayType.POLYGON]
    };
    const markerOptions: MarkerOptions = {
      icon: 'https://developers.google.com/maps/documentation/javascript/examples/full/images/beachflag.png',
      position: new google.maps.LatLng(environment.initLat, environment.initLng)
    };
    this.drawingManager = new google.maps.drawing.DrawingManager({
      drawingMode: OverlayType.RECTANGLE,
      drawingControl: true,
      drawingControlOptions,
      markerOptions,
      polygonOptions: {
        fillColor: colors.colorArea,
        fillOpacity: 0.2,
        strokeWeight: 3,
        clickable: true,
        editable: true,
        draggable: true,
        zIndex: 1
      }
    });
    google.maps.event.addListener(this.drawingManager, 'overlaycomplete', (e) => {
      if (e.type != google.maps.drawing.OverlayType.MARKER) {
        // Switch back to non-drawing mode after drawing a origin.
        this.drawingManager.setDrawingMode(null);

        if (e.type == OverlayType.RECTANGLE) {
          const r = e.overlay as Rectangle;

          // create polygon from bounds
          const polygon = new Polygon();
          let northEast = r.getBounds().getNorthEast();
          let southWest = r.getBounds().getSouthWest();
          polygon.setPath([northEast, new LatLng(northEast.lat(), southWest.lng()), southWest, new LatLng(southWest.lat(), northEast.lng())]);
          polygon.setOptions({draggable: true});
          polygon.setMap(this.map);
          e.overlay.setMap(null);
          e.overlay = polygon;
        }

        this.shadowShapesSet.onShapeAdded(e.overlay, this._ngZone, this.shadowService);
        this.drawingManager.setDrawingMode(null);
      }
    });
    this.drawingManager.setMap(this.map);
  }

  openHelpDialog() {
    let dialogRef = this.dialog.open(HelpDialogComponent);
  }

  openSettingsDialog() {
    let dialogRef = this.dialog.open(SettingsDialogComponent);
  }

  openImportExportDialog() {
    const jsonObj = this.shadowShapesSet.toJSON();
    jsonObj.timestamp = this.shadowService.getDate().getTime();
    jsonObj.mapCenterLat = this.map.getCenter().lat();
    jsonObj.mapCenterLng = this.map.getCenter().lng();
    let dialogRef = this.dialog.open(ShapesLoaderDialogComponent, {
      data: jsonObj
    });
    dialogRef.afterClosed().subscribe((jsonText) => {
      if (jsonText != null && jsonText != "") {
        const json: ShapesJSON = JSON.parse(jsonText);
        if (json.timestamp != null) {
          this.shadowService.setDateAndTimeFromModel(json);
        }
        if (json.mapCenterLng != null && json.mapCenterLat != null) {
          this.map.setCenter(new LatLng(json.mapCenterLat, json.mapCenterLng));
        }
        this.shadowShapesSet.fromJSON(json, this._ngZone, this.shadowService);
        this.drawingManager.setDrawingMode(null);

      }
    });
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if(event.key === 'Delete'  && this.shadowShapesSet.currentShape != null) {
      this.deleteShape();
    }

    if (event.ctrlKey && this.shadowShapesSet.currentShape != null) {
      let x = 0, y = 0;

      if (event.key == "ArrowLeft") {
        x = -0.1;
      } else if (event.key == "ArrowRight") {
        x = 0.1;
      } else if (event.key == "ArrowUp") {
        y = 0.1;
      } else if (event.key == "ArrowDown") {
        y = -0.1;
      }
      if (x != 0 || y != 0) {
        this.moveShape({x, y});
      }
    }
    if (event.shiftKey && event.ctrlKey && this.shadowShapesSet.currentShape != null) {
      let r = 0;
      const degreeToRatate = 1;
      if (event.key == "ArrowLeft") {
        r = -degreeToRatate * Math.PI / 180;
      } else if (event.key == "ArrowRight") {
        r = degreeToRatate * Math.PI / 180;
      }
      if (r != 0) {
        this.rotateShape(r);
      }
    }
  }

  deleteShape() {
    this.shadowShapesSet.deleteShadowShape(this.shadowShapesSet.currentShape);
  }

  moveShape(xy: XY) {
    this.shadowShapesSet.moveShape(this.shadowShapesSet.currentShape, xy.x, xy.y, this._ngZone, this.shadowService);
  }
  rotateShape(r: number) {
    this.shadowShapesSet.rotateShape(this.shadowShapesSet.currentShape, r, this._ngZone, this.shadowService);
  }

}

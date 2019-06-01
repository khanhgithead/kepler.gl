// Copyright (c) 2019 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import {ScenegraphLayer as DeckScenegraphLayer} from '@deck.gl/mesh-layers';
import {load} from '@loaders.gl/core';
import {GLTFScenegraphLoader} from '@luma.gl/addons';

import Layer from '../base-layer';
import memoize from 'lodash.memoize';
import ScenegraphLayerIcon from './scenegraph-layer-icon';

export const scenegraphRequiredColumns = ['lat', 'lng'];
export const scenegraphOptionalColumns = ['altitude'];

export const scenegraphPosAccessor = ({lat, lng, altitude}) => d => [
  // lng
  d.data[lng.fieldIdx],
  // lat
  d.data[lat.fieldIdx],
  // altitude
  altitude && altitude.fieldIdx > -1 ? d.data[altitude.fieldIdx] : 0
];

export const scenegraphPosResolver = ({lat, lng, altitude}) =>
  `${lat.fieldIdx}-${lng.fieldIdx}-${altitude ? altitude.fieldIdx : 'z'}`;

export const scenegraphVisConfigs = {
  radius: 'radius',
  fixedRadius: 'fixedRadius',
  opacity: 'opacity',
  colorRange: 'colorRange',
  radiusRange: 'radiusRange',
  //
  sizeScale: 'sizeScale',
  angleX: 'angleX',
  angleY: 'angleY',
  angleZ: 'angleZ'
};

export default class ScenegraphLayer extends Layer {
  constructor(props) {
    super(props);

    this.registerVisConfig(scenegraphVisConfigs);
    this.getPosition = memoize(scenegraphPosAccessor, scenegraphPosResolver);

    // prepare layer info modal
    // this._layerInfoModal = IconInfoModalFactory();
    // this.getSvgIcons();
  }

  get type() {
    return '3D';
  }

  get requiredLayerColumns() {
    return scenegraphRequiredColumns;
  }

  get optionalColumns() {
    return scenegraphOptionalColumns;
  }

  get columnPairs() {
    return this.defaultPointColumnPairs;
  }

  get layerIcon() {
    return ScenegraphLayerIcon;
  }

  get visualChannels() {
    return {
      ...super.visualChannels,
      size: {
        ...super.visualChannels.size,
        range: 'radiusRange',
        property: 'radius',
        channelScaleType: 'radius'
      }
    };
  }

  get layerInfoModal() {
    return {
      id: 'iconInfo',
      template: this._layerInfoModal,
      modalProps: {
        title: 'How to draw icons'
      }
    };
  }

  static findDefaultLayerProps({fieldPairs, fields}) {
    if (!fieldPairs.length) {
      return [];
    }

    const iconFields = fields.filter(({name}) =>
      name
        .replace(/[_,.]+/g, ' ')
        .trim()
        .split(' ')
        .some(seg => ({}.icon.some(t => t.includes(seg))))
    );

    if (!iconFields.length) {
      return [];
    }

    // create icon layers for first point pair
    const ptPair = fieldPairs[0];

    const props = iconFields.map(iconField => ({
      label: '???',
      columns: {
        lat: ptPair.pair.lat,
        lng: ptPair.pair.lng
      },
      isVisible: true
    }));

    return props;
  }

  // TODO: fix complexity
  /* eslint-disable complexity */
  formatLayerData(_, allData, filteredIndex, oldLayerData, opt = {}) {
    const {
      colorScale,
      colorDomain,
      colorField,
      color,
      columns,
      sizeField,
      sizeScale,
      sizeDomain,
      visConfig: {
        radiusRange,
        colorRange,
        sizeScale: sizeScale3D,
        angleX = 0,
        angleY = 0,
        angleZ = 0
      }
    } = this.config;

    // point color
    const cScale =
      colorField &&
      this.getVisChannelScale(
        colorScale,
        colorDomain,
        colorRange.colors.map(hexToRgb)
      );

    // point radius
    const rScale =
      sizeField && this.getVisChannelScale(sizeScale, sizeDomain, radiusRange);

    const getPosition = this.getPosition(columns);

    if (!oldLayerData || oldLayerData.getPosition !== getPosition) {
      this.updateLayerMeta(allData, getPosition);
    }

    let data;
    if (
      oldLayerData &&
      oldLayerData.data &&
      opt.sameData &&
      oldLayerData.getPosition === getPosition
    ) {
      data = oldLayerData.data;
    } else {
      data = filteredIndex.reduce((accu, index) => {
        const pos = getPosition({data: allData[index]});

        // if doesn't have point lat or lng, do not add the point
        // deck.gl can't handle position = null
        if (!pos.every(Number.isFinite)) {
          return accu;
        }

        accu.push({
          index,
          data: allData[index]
        });

        return accu;
      }, []);
    }

    const getRadius = rScale
      ? d => this.getEncodedChannelValue(rScale, d.data, sizeField)
      : 1;

    const getColor = cScale
      ? d => this.getEncodedChannelValue(cScale, d.data, colorField)
      : color;

    return {
      data,
      getPosition,
      getColor,
      getRadius,
      sizeScale: sizeScale3D,
      getOrientation: [angleX, angleY, angleZ]
    };
  }
  /* eslint-enable complexity */

  updateLayerMeta(allData, getPosition) {
    const bounds = this.getPointsBounds(allData, d => getPosition({data: d}));
    this.updateMeta({bounds});
  }

  renderLayer({
    data,
    idx,
    objectHovered,
    mapState,
    interactionConfig,
    layerInteraction
  }) {
    const layerProps = {
      radiusMinPixels: 1,
      radiusScale: this.getRadiusScaleByZoom(mapState),
      ...(this.config.visConfig.fixedRadius ? {} : {radiusMaxPixels: 500})
    };

    // console.log(this, {idx, data});
    // console.log('>>>', data.getPosition(data.data[0]));

    return [
      new DeckScenegraphLayer({
        ...layerProps,
        ...data,
        ...layerInteraction,
        id: this.id,
        idx,
        opacity: this.config.visConfig.opacity,

        fetch: (url, {propName, layer}) => {
          if (propName === 'scenegraph') {
            console.log("FETCH->LOAD", url);
            return load(url, GLTFScenegraphLoader, layer.getLoadOptions());
          }

          return fetch(url).then(response => response.json());
        },

        // sizeScale: 50,
        scenegraph:
          this.config.visConfig.scenegraph ||
          'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb',

        // getOrientation: d => [
        //   Math.random() * 360,
        //   Math.random() * 360,
        //   Math.random() * 360
        // ],
        getTranslation: d => [0, 0, 0],
        getScale: [1, 1, 1],
        getColor: [255, 255, 255, 255],

        _lighting: 'pbr',

        // picking
        // autoHighlight: true,
        // highlightColor: this.config.highlightColor,
        pickable: true,

        // parameters
        parameters: {depthTest: true, blend: false},

        // update triggers
        updateTriggers: {
          getOrientation: data.getOrientation
          // getRadius: {
          //   sizeField: this.config.colorField,
          //   radiusRange: this.config.visConfig.radiusRange,
          //   sizeScale: this.config.sizeScale
          // },
          // getColor: {
          //   color: this.config.color,
          //   colorField: this.config.colorField,
          //   colorRange: this.config.visConfig.colorRange,
          //   colorScale: this.config.colorScale
          // }
        }
      })
    ];
  }
}

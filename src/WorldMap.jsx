import React from 'react';
import WorldMap2D from './WorldMap2D';
import WorldMap3D from './WorldMap3D';

export default function WorldMap(props) {
  return props.currentMode === '3d'
    ? <WorldMap3D {...props} />
    : <WorldMap2D {...props} />;
}

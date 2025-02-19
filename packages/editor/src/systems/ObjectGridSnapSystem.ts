/*
CPAL-1.0 License

The contents of this file are subject to the Common Public Attribution License
Version 1.0. (the "License"); you may not use this file except in compliance
with the License. You may obtain a copy of the License at
https://github.com/EtherealEngine/etherealengine/blob/dev/LICENSE.
The License is based on the Mozilla Public License Version 1.1, but Sections 14
and 15 have been added to cover use of software over a computer network and 
provide for limited attribution for the Original Developer. In addition, 
Exhibit A has been modified to be consistent with Exhibit B.

Software distributed under the License is distributed on an "AS IS" basis,
WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the
specific language governing rights and limitations under the License.

The Original Code is Ethereal Engine.

The Original Developer is the Initial Developer. The Initial Developer of the
Original Code is the Ethereal Engine team.

All portions of the code written by the Ethereal Engine team are Copyright © 2021-2023 
Ethereal Engine. All Rights Reserved.
*/

import { EngineState } from '@etherealengine/engine/src/ecs/classes/EngineState'
import { Entity, UndefinedEntity } from '@etherealengine/engine/src/ecs/classes/Entity'
import {
  getComponent,
  getOptionalComponent,
  hasComponent,
  setComponent
} from '@etherealengine/engine/src/ecs/functions/ComponentFunctions'
import { EntityTreeComponent } from '@etherealengine/engine/src/ecs/functions/EntityTree'
import { defineQuery } from '@etherealengine/engine/src/ecs/functions/QueryFunctions'
import { defineSystem } from '@etherealengine/engine/src/ecs/functions/SystemFunctions'
import { GroupComponent } from '@etherealengine/engine/src/scene/components/GroupComponent'
import { ObjectGridSnapComponent } from '@etherealengine/engine/src/scene/components/ObjectGridSnapComponent'
import { ObjectLayers } from '@etherealengine/engine/src/scene/constants/ObjectLayers'
import { setObjectLayers } from '@etherealengine/engine/src/scene/functions/setObjectLayers'
import { TransformComponent } from '@etherealengine/engine/src/transform/components/TransformComponent'
import { TransformSystem } from '@etherealengine/engine/src/transform/systems/TransformSystem'
import { defineState, getMutableState, getState, useHookstate } from '@etherealengine/hyperflux'
import { useEffect } from 'react'
import { Box3, Color, LineBasicMaterial, LineSegments, Matrix4, Quaternion, Vector3 } from 'three'
import { EditorControlFunctions } from '../functions/EditorControlFunctions'
import { SelectionState } from '../services/SelectionServices'

const objectGridQuery = defineQuery([ObjectGridSnapComponent])

function isParentSelected(entity: Entity) {
  let walker: Entity | null = entity
  const selectedEntities = getState(SelectionState).selectedEntities
  while (walker) {
    if (selectedEntities.includes(walker)) return walker
    walker = getOptionalComponent(walker, EntityTreeComponent)?.parentEntity ?? null
  }
  return false
}

const scale1 = new Vector3()
const scale2 = new Vector3()
function bboxDistance(bbox1: Box3, bbox2: Box3, matrixWorld1: Matrix4, matrixWorld2: Matrix4) {
  matrixWorld1.decompose(new Vector3(), new Quaternion(), scale1)
  matrixWorld2.decompose(new Vector3(), new Quaternion(), scale2)
  const maxAxis1 = Math.max(Math.abs(scale1.x), Math.abs(scale1.y), Math.abs(scale1.z))
  const maxAxis2 = Math.max(Math.abs(scale2.x), Math.abs(scale2.y), Math.abs(scale2.z))
  const center1 = bbox1.getCenter(new Vector3())
  const center2 = bbox2.getCenter(new Vector3())
  const center1World = center1.clone().applyMatrix4(matrixWorld1)
  const center2World = center2.clone().applyMatrix4(matrixWorld2)
  const radius1 = (bbox1.getSize(new Vector3()).length() * maxAxis1) / 2
  const radius2 = (bbox2.getSize(new Vector3()).length() * maxAxis2) / 2
  return center1World.distanceTo(center2World) - radius1 - radius2
}

function findClosestAxis(axis: Vector3, candidates: Vector3[]) {
  let minAngle = Infinity
  let minAxis = new Vector3()
  for (const candidate of candidates) {
    const angle = axis.angleTo(candidate)
    if (angle < minAngle) {
      minAngle = angle
      minAxis = candidate
    }
  }
  return minAxis
}

function alignToClosestAxis(matrix1: Matrix4, matrix2: Matrix4): Matrix4 {
  const srcAxes = getAxes(matrix1)
  const dstAxes = getAxes(matrix2)
  const forward = srcAxes[0]
  const up = srcAxes[1]
  const right = srcAxes[2] //find rotations for each axis to the closest dst axis
  const dstForward = findClosestAxis(forward, dstAxes)
  dstAxes.splice(dstAxes.indexOf(dstForward), 1)
  const upAxes = dstAxes.filter((axis) => Math.abs(axis.dot(dstForward)) < Number.EPSILON)
  const dstUp = findClosestAxis(up, upAxes)
  dstAxes.splice(dstAxes.indexOf(dstUp), 1)
  const rightAxes = dstAxes.filter(
    (axis) => Math.abs(axis.dot(dstForward)) < Number.EPSILON && Math.abs(axis.dot(dstUp)) < Number.EPSILON
  )
  const dstRight = findClosestAxis(right, rightAxes)
  //create rotation matrix
  const rotation = new Matrix4()
  rotation.makeBasis(dstRight, dstUp, dstForward)
  return rotation
}

function getAxes(matrix: Matrix4): Vector3[] {
  const rotation = new Quaternion().setFromRotationMatrix(matrix)
  const forward = new Vector3(0, 0, 1).applyQuaternion(rotation)
  const up = new Vector3(0, 1, 0).applyQuaternion(rotation)
  const right = new Vector3(1, 0, 0).applyQuaternion(rotation)
  const down = up.clone().negate()
  const left = right.clone().negate()
  const back = forward.clone().negate()
  return [forward, up, right, down, left, back]
}

function boundedTranslation(bbox1: Box3, bbox2: Box3, matrixWorld1: Matrix4, matrixWorld2: Matrix4): Vector3 {
  // Transform the bounding boxes to world space
  const transformedBBox1 = transformBoundingBox(bbox1, matrixWorld1)
  const transformedBBox2 = transformBoundingBox(bbox2, matrixWorld2)
  // Calculate the translation vector
  return calculateTranslation(transformedBBox1, transformedBBox2)
}

function transformBoundingBox(bbox: Box3, matrix: Matrix4): Box3 {
  const points = [
    new Vector3(bbox.min.x, bbox.min.y, bbox.min.z),
    new Vector3(bbox.min.x, bbox.min.y, bbox.max.z),
    new Vector3(bbox.min.x, bbox.max.y, bbox.min.z),
    new Vector3(bbox.min.x, bbox.max.y, bbox.max.z),
    new Vector3(bbox.max.x, bbox.min.y, bbox.min.z),
    new Vector3(bbox.max.x, bbox.min.y, bbox.max.z),
    new Vector3(bbox.max.x, bbox.max.y, bbox.min.z),
    new Vector3(bbox.max.x, bbox.max.y, bbox.max.z)
  ]

  return points.reduce((acc, point) => {
    point.applyMatrix4(matrix)
    acc.expandByPoint(point)
    return acc
  }, new Box3())
}

function calculateTranslation(bbox1: Box3, bbox2: Box3): Vector3 {
  // Assuming bbox1 and bbox2 are now aligned and treated as axis-aligned
  const translation = new Vector3()
  // Calculate the translation needed for each axis
  for (const axis of ['x', 'y', 'z']) {
    if (bbox1.max[axis] < bbox2.min[axis]) {
      translation[axis] = bbox2.min[axis] - bbox1.max[axis]
    } else if (bbox1.min[axis] > bbox2.max[axis]) {
      translation[axis] = bbox2.max[axis] - bbox1.min[axis]
    } else {
      //align an edge of bbox1 with an edge of bbox2
      const box1Pts = [bbox1.min[axis], (bbox1.min[axis] + bbox1.max[axis]) / 2, bbox1.max[axis]]
      const box2Pts = [bbox2.min[axis], (bbox2.min[axis] + bbox2.max[axis]) / 2, bbox2.max[axis]]
      let minDist = Infinity
      let pt1 = 0
      let pt2 = 0
      for (const box1Pt of box1Pts) {
        for (const box2Pt of box2Pts) {
          const dist = Math.abs(box1Pt - box2Pt)
          if (dist < minDist) {
            minDist = dist
            pt1 = box1Pt
            pt2 = box2Pt
            if (dist === 0) break
          }
        }
        if (minDist === 0) break
      }
      translation[axis] = pt2 - pt1
    }
  }
  return translation
}

export const ObjectGridSnapState = defineState({
  name: 'ObjectGridSnapState',
  initial: {
    enabled: false,
    apply: false
  }
})

function setHelperLayer(entity: Entity, layer: number) {
  const helper = getComponent(entity, ObjectGridSnapComponent).helper
  if (helper) {
    const helperObj = getComponent(helper, GroupComponent)[0]
    setObjectLayers(helperObj, layer)
  }
}

function setHelperColor(entity: Entity, color: Color) {
  const helper = getComponent(entity, ObjectGridSnapComponent).helper
  if (helper) {
    const helperObj = getComponent(helper, GroupComponent)[0] as LineSegments
    const material = helperObj.material as LineBasicMaterial
    material.color.copy(color)
  }
}

function resetHelperTransform(entity: Entity) {
  const helper = getComponent(entity, ObjectGridSnapComponent).helper
  if (helper) {
    setComponent(helper, TransformComponent, {
      position: new Vector3(),
      rotation: new Quaternion().identity(),
      scale: new Vector3(1, 1, 1)
    })
  }
}

export const ObjectGridSnapSystem = defineSystem({
  uuid: 'ee.engine.scene.ObjectGridSnapSystem',
  insert: { after: TransformSystem },
  reactor: () => {
    const snapState = useHookstate(getMutableState(ObjectGridSnapState))
    const selectionState = useHookstate(getMutableState(SelectionState))

    useEffect(() => {
      if (!snapState.enabled.value) {
        for (const entity of objectGridQuery()) {
          setHelperColor(entity, new Color(1, 0, 0))
          setHelperLayer(entity, ObjectLayers.NodeHelper)
          resetHelperTransform(entity)
        }
      }
    }, [snapState.enabled])

    useEffect(() => {
      const selectedEntities = [...selectionState.selectedEntities.value]
      return () => {
        for (const entity of selectedEntities) {
          if (selectionState.selectedEntities.value.includes(entity)) continue
          if (!hasComponent(entity, ObjectGridSnapComponent)) continue
          resetHelperTransform(entity)
        }
      }
    }, [selectionState.selectedEntities])

    return null
  },
  execute: () => {
    const engineState = getState(EngineState)
    if (!engineState.isEditing) return
    const snapState = getState(ObjectGridSnapState)
    if (!snapState.enabled) return
    const entities = objectGridQuery()
    const selectedEntities: Entity[] = []
    const selectedParents: Entity[] = []
    const nonSelectedEntities: Entity[] = []
    for (const entity of entities) {
      const parent = isParentSelected(entity)
      if (parent) {
        selectedEntities.push(entity)
        selectedParents.push(parent)
        setHelperLayer(entity, ObjectLayers.Scene)
        setHelperColor(entity, new Color(1, 1, 1))
      } else {
        nonSelectedEntities.push(entity)
        setHelperLayer(entity, ObjectLayers.NodeHelper)
        setHelperColor(entity, new Color(1, 0, 0))
      }
    }
    if (selectedEntities.length === 0) return
    for (let i = 0; i < selectedEntities.length; i++) {
      const selectedEntity = selectedEntities[i]
      const selectedParent = selectedParents[i]

      const selectedBBox = getComponent(selectedEntity, ObjectGridSnapComponent).bbox
      const selectedMatrixWorld = getComponent(selectedEntity, TransformComponent).matrixWorld
      const closestEntities: Entity[] = []
      const distanceThreshold = 1
      for (const candidateEntity of nonSelectedEntities) {
        const candidateBBox = getComponent(candidateEntity, ObjectGridSnapComponent).bbox
        const candidateMatrixWorld = getComponent(candidateEntity, TransformComponent).matrixWorld
        const distance = bboxDistance(selectedBBox, candidateBBox, selectedMatrixWorld, candidateMatrixWorld)
        if (distance <= distanceThreshold) {
          closestEntities.push(candidateEntity)
          setHelperLayer(candidateEntity, ObjectLayers.Scene)
        }
      }
      const selectedSnapComponent = getComponent(selectedEntity, ObjectGridSnapComponent)
      const commitNoOp = () => {
        const helperEntity = selectedSnapComponent.helper
        if (helperEntity) {
          //reset helper bbox if exists
          setComponent(helperEntity, TransformComponent, {
            position: new Vector3(),
            rotation: new Quaternion().identity(),
            scale: new Vector3(1, 1, 1)
          })
        }
        if (getState(ObjectGridSnapState).apply) {
          EditorControlFunctions.commitTransformSave([selectedParent])
          getMutableState(ObjectGridSnapState).apply.set(false)
        }
      }
      if (closestEntities.length === 0) {
        commitNoOp()
        continue
      }
      let leastOffset = Infinity
      let closestEntity = UndefinedEntity
      for (const candidateEntity of closestEntities) {
        const candidateBBox = getComponent(candidateEntity, ObjectGridSnapComponent).bbox
        const selectedMatrixClone = selectedMatrixWorld.clone()
        const candidateMatrixWorld = getComponent(candidateEntity, TransformComponent).matrixWorld.clone()
        const rotationMatrix = alignToClosestAxis(selectedMatrixClone, candidateMatrixWorld)
        const position = new Vector3(
          selectedMatrixClone.elements[12],
          selectedMatrixClone.elements[13],
          selectedMatrixClone.elements[14]
        )
        selectedMatrixClone.extractRotation(rotationMatrix)
        selectedMatrixClone.setPosition(position)
        const translation = boundedTranslation(
          selectedBBox,
          candidateBBox,
          new Matrix4().identity(),
          selectedMatrixClone.clone().invert().multiply(candidateMatrixWorld)
        )
        const offset = translation.length()
        if (offset < leastOffset) {
          leastOffset = offset
          closestEntity = candidateEntity
        }
      }
      if (closestEntity === UndefinedEntity) {
        commitNoOp()
        continue
      } else {
        setHelperColor(closestEntity, new Color(0, 1, 0))
      }
      const closestBBox = getComponent(closestEntity, ObjectGridSnapComponent).bbox
      const closestMatrixWorld = getComponent(closestEntity, TransformComponent).matrixWorld
      const parentMatrixWorld = getComponent(selectedParent, TransformComponent).matrixWorld
      const srcMatrixWorld = parentMatrixWorld.clone()
      const rotationMatrix = alignToClosestAxis(selectedMatrixWorld, closestMatrixWorld)
      const position = new Vector3()
      const scale = new Vector3()
      srcMatrixWorld.decompose(position, new Quaternion(), scale)
      const dstEntity = getState(ObjectGridSnapState).apply ? selectedParent : selectedSnapComponent.helper
      if (!dstEntity) {
        commitNoOp()
        continue
      }
      const dstMatrixWorld = getComponent(dstEntity, TransformComponent).matrixWorld
      dstMatrixWorld.extractRotation(rotationMatrix)
      dstMatrixWorld.scale(scale)
      dstMatrixWorld.setPosition(position)
      TransformComponent.updateFromWorldMatrix(dstEntity)
      const translation = boundedTranslation(
        selectedBBox,
        closestBBox,
        new Matrix4().identity(),
        dstMatrixWorld.clone().invert().multiply(closestMatrixWorld)
      )
      dstMatrixWorld.multiply(new Matrix4().makeTranslation(translation))
      TransformComponent.updateFromWorldMatrix(dstEntity)
      if (getState(ObjectGridSnapState).apply) {
        EditorControlFunctions.commitTransformSave([dstEntity])
        getMutableState(ObjectGridSnapState).apply.set(false)
      }
      break
    }
  }
})

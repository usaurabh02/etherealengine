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

import { useEffect } from 'react'
import {
  ConeGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3
} from 'three'

import { smootheLerpAlpha } from '@etherealengine/common/src/utils/smootheLerpAlpha'
import { defineActionQueue, defineState, getMutableState, getState, useHookstate } from '@etherealengine/hyperflux'

import { AvatarInputSettingsState } from '../avatar/state/AvatarInputSettingsState'
import { mergeBufferGeometries } from '../common/classes/BufferGeometryUtils'
import { V_010 } from '../common/constants/MathConstants'
import { Engine } from '../ecs/classes/Engine'
import { EngineState } from '../ecs/classes/EngineState'
import { Entity } from '../ecs/classes/Entity'
import {
  ComponentType,
  getComponent,
  getMutableComponent,
  removeComponent,
  setComponent,
  useOptionalComponent
} from '../ecs/functions/ComponentFunctions'
import { createEntity } from '../ecs/functions/EntityFunctions'
import { EntityTreeComponent } from '../ecs/functions/EntityTree'
import { defineQuery, useQuery } from '../ecs/functions/QueryFunctions'
import { defineSystem } from '../ecs/functions/SystemFunctions'
import { InputComponent } from '../input/components/InputComponent'
import { InputSourceComponent } from '../input/components/InputSourceComponent'
import { addObjectToGroup } from '../scene/components/GroupComponent'
import { NameComponent } from '../scene/components/NameComponent'
import { VisibleComponent, setVisibleComponent } from '../scene/components/VisibleComponent'
import { ReferenceSpaceTransformSystem } from '../transform/TransformModule'
import { TransformComponent } from '../transform/components/TransformComponent'
import { updateWorldOriginFromScenePlacement } from '../transform/updateWorldOrigin'
import { XRAnchorComponent, XRHitTestComponent } from './XRComponents'
import { ReferenceSpace, XRAction, XRState } from './XRState'

export const updateHitTest = (entity: Entity) => {
  const xrFrame = getState(XRState).xrFrame!
  const hitTest = getMutableComponent(entity, XRHitTestComponent)
  if (!hitTest.source.value) return

  const hitTestResults = xrFrame.getHitTestResults(hitTest.source.value)
  hitTest.results.set(hitTestResults)

  if (!hitTestResults?.length) return

  const pose = hitTestResults[0].getPose(ReferenceSpace.localFloor!)
  if (!pose) return

  const parentEntity = Engine.instance.originEntity
  setComponent(entity, EntityTreeComponent, { parentEntity })

  const transform = getComponent(entity, TransformComponent)
  transform.position.copy(pose.transform.position as any)
  transform.rotation.copy(pose.transform.orientation as any)
}

export const updateAnchor = (entity: Entity) => {
  const xrFrame = getState(XRState).xrFrame!
  const anchor = getComponent(entity, XRAnchorComponent).anchor
  const transform = getComponent(entity, TransformComponent)
  const pose = ReferenceSpace.localFloor && xrFrame.getPose(anchor.anchorSpace, ReferenceSpace.localFloor)
  if (pose) {
    transform.position.copy(pose.transform.position as any)
    transform.rotation.copy(pose.transform.orientation as any)
  }
}

const _plane = new Plane()
const _vecPosition = new Vector3()
const _quat = new Quaternion()

/**
 * Lock lifesize to 1:1, whereas dollhouse mode uses
 * the distance from the camera to the hit test plane.
 *
 * Miniature scale math shrinks linearly from 20% to 1%, between 1 meters to 0.01 meters from the hit test plane
 */
const minDollhouseScale = 0.01
const maxDollhouseScale = 0.2
const minDollhouseDist = 0.01
const maxDollhouseDist = 1

const getTargetWorldSize = (transform: ComponentType<typeof TransformComponent>) => {
  const xrState = getState(XRState)
  const placing = xrState.scenePlacementMode === 'placing'
  if (!placing) return xrState.sceneScale

  const xrFrame = getState(XRState).xrFrame
  if (!xrFrame) return 1

  const viewerPose = xrFrame.getViewerPose(ReferenceSpace.localFloor!)
  if (!viewerPose) return 1

  const upDir = _vecPosition.set(0, 1, 0).applyQuaternion(transform.rotation)
  const dist = _plane
    .setFromNormalAndCoplanarPoint(upDir, transform.position)
    .distanceToPoint(viewerPose.transform.position as any)

  /**
   * For immersive AR, always use life size in auto scale mode, and always use miniature size in manual scale mode
   * For non-immerse AR, use miniature size when the camera is close to the hit test plane and the camera is looking down
   * */
  const lifeSize =
    xrState.session!.interactionMode === 'world-space'
      ? xrState.sceneScaleAutoMode
      : dist > maxDollhouseDist && upDir.angleTo(V_010) < Math.PI * 0.02

  if (lifeSize) return 1

  const normalizedDist = MathUtils.clamp(dist, minDollhouseDist, maxDollhouseDist)

  const scalingFactor = maxDollhouseDist - minDollhouseDist

  return MathUtils.clamp(Math.pow(normalizedDist, 2) * scalingFactor, minDollhouseScale, maxDollhouseScale)
}

export const updateScenePlacement = (scenePlacementEntity: Entity) => {
  // assumes local transform is relative to origin
  const transform = getComponent(scenePlacementEntity, TransformComponent)

  const xrState = getState(XRState)
  const xrFrame = xrState.xrFrame
  const xrSession = xrState.session

  if (!transform || !xrFrame || !xrSession) return

  const deltaSeconds = getState(EngineState).deltaSeconds
  const lerpAlpha = smootheLerpAlpha(5, deltaSeconds)

  const sceneScaleAutoMode = xrState.sceneScaleAutoMode

  if (sceneScaleAutoMode) {
    const targetScale = getTargetWorldSize(transform)
    getMutableState(XRState).sceneScaleTarget.set(targetScale)
  }

  const targetScale = xrState.sceneScaleTarget
  if (targetScale !== xrState.sceneScale) {
    const newScale = MathUtils.lerp(xrState.sceneScale, targetScale, lerpAlpha)
    getMutableState(XRState).sceneScale.set(newScale > 0.9 ? 1 : newScale)
  }

  xrState.scenePosition.copy(transform.position)
  xrState.sceneRotation.multiplyQuaternions(
    transform.rotation,
    _quat.setFromAxisAngle(V_010, xrState.sceneRotationOffset)
  )
}

const xrSessionChangedQueue = defineActionQueue(XRAction.sessionChanged.matches)

const xrHitTestQuery = defineQuery([XRHitTestComponent, TransformComponent])
const xrAnchorQuery = defineQuery([XRAnchorComponent, TransformComponent])

export const XRAnchorSystemState = defineState({
  name: 'XRAnchorSystemState',
  initial: () => {
    const scenePlacementEntity = createEntity()
    setComponent(scenePlacementEntity, NameComponent, 'xr-scene-placement')
    setComponent(scenePlacementEntity, TransformComponent)
    setComponent(scenePlacementEntity, EntityTreeComponent, { parentEntity: Engine.instance.originEntity })
    setComponent(scenePlacementEntity, VisibleComponent, true)
    setComponent(scenePlacementEntity, InputComponent, { highlight: false, grow: false })

    const scenePlacementRingGeom = new RingGeometry(0.08, 0.1, 16)
    scenePlacementRingGeom.rotateX(-Math.PI / 2)
    scenePlacementRingGeom.translate(0, 0.01, 0)

    const pinSphereGeometry = new SphereGeometry(0.025, 16, 16)
    pinSphereGeometry.translate(0, 0.1125, 0)
    const pinConeGeom = new ConeGeometry(0.01, 0.1, 16)
    pinConeGeom.rotateX(Math.PI)
    pinConeGeom.translate(0, 0.05, 0)

    const mergedGeometry = mergeBufferGeometries([scenePlacementRingGeom, pinSphereGeometry, pinConeGeom])!

    const originAnchorMesh = new Mesh(mergedGeometry, new MeshBasicMaterial({ color: 'white' }))
    originAnchorMesh.name = 'world-origin-pinpoint-anchor'

    const originAnchorEntity = createEntity()
    setComponent(originAnchorEntity, NameComponent, 'xr-world-anchor')
    addObjectToGroup(originAnchorEntity, originAnchorMesh)

    return {
      scenePlacementEntity,
      originAnchorEntity
    }
  }
})

const execute = () => {
  const xrState = getState(XRState)

  const { scenePlacementEntity, originAnchorEntity } = getState(XRAnchorSystemState)

  for (const action of xrSessionChangedQueue()) {
    if (!action.active) {
      setComponent(Engine.instance.originEntity, TransformComponent) // reset world origin
      getMutableState(XRState).scenePlacementMode.set('unplaced')
      for (const e of xrHitTestQuery()) removeComponent(e, XRHitTestComponent)
      for (const e of xrAnchorQuery()) removeComponent(e, XRAnchorComponent)
    }
  }

  if (!getState(XRState).xrFrame) return

  for (const entity of xrAnchorQuery()) updateAnchor(entity)
  for (const entity of xrHitTestQuery()) updateHitTest(entity)

  if (xrState.scenePlacementMode === 'placing') {
    updateScenePlacement(scenePlacementEntity)
    updateWorldOriginFromScenePlacement()

    const inverseWorldScale = 1 / XRState.worldScale
    getComponent(originAnchorEntity, TransformComponent).scale.setScalar(inverseWorldScale)
  }
}

const reactor = () => {
  const xrState = getMutableState(XRState)
  const { scenePlacementEntity, originAnchorEntity } = getState(XRAnchorSystemState)
  const scenePlacementMode = useHookstate(xrState.scenePlacementMode)
  const xrSession = useHookstate(xrState.session)
  const hitTest = useOptionalComponent(scenePlacementEntity, XRHitTestComponent)

  useEffect(() => {
    if (!xrSession.value) return

    let active = true

    if (scenePlacementMode.value === 'unplaced') {
      removeComponent(scenePlacementEntity, XRHitTestComponent)
      removeComponent(scenePlacementEntity, XRAnchorComponent)
      setVisibleComponent(originAnchorEntity, false)
      return
    }

    if (scenePlacementMode.value === 'placing') {
      // create a hit test source for the viewer when the interaction mode is 'screen-space'
      if (xrSession.value.interactionMode === 'screen-space') {
        setVisibleComponent(originAnchorEntity, true)
        setComponent(scenePlacementEntity, XRHitTestComponent, {
          space: ReferenceSpace.viewer!,
          entityTypes: ['plane', 'point', 'mesh']
        })
      }
    }

    if (scenePlacementMode.value === 'placed') {
      setVisibleComponent(originAnchorEntity, false)
      const hitTestResult = hitTest?.results?.value?.[0]
      if (hitTestResult) {
        if (!hitTestResult.createAnchor) {
          const xrFrame = getState(XRState).xrFrame
          const hitPose = ReferenceSpace.localFloor && hitTestResult.getPose(ReferenceSpace.localFloor)
          hitPose &&
            xrFrame?.createAnchor?.(hitPose.transform, ReferenceSpace.localFloor!)?.then((anchor) => {
              if (!active) {
                anchor.delete()
                return
              }
              setComponent(scenePlacementEntity, XRAnchorComponent, { anchor })
            })
          removeComponent(scenePlacementEntity, XRHitTestComponent)
          return
        }
        // @ts-ignore createAnchor function is not typed correctly
        const anchorPromise = hitTestResult.createAnchor()
        if (anchorPromise)
          anchorPromise
            .then((anchor) => {
              if (!active) {
                anchor.delete()
                return
              }
              setComponent(scenePlacementEntity, XRAnchorComponent, { anchor })
              removeComponent(scenePlacementEntity, XRHitTestComponent)
            })
            .catch(() => {
              removeComponent(scenePlacementEntity, XRHitTestComponent)
            })
        else removeComponent(scenePlacementEntity, XRHitTestComponent)
      }
    }

    return () => {
      active = false
    }
  }, [scenePlacementMode, xrSession])

  const inputSourceEntities = useQuery([InputSourceComponent])

  /** Immersive AR controller placement */
  useEffect(() => {
    if (!xrSession.value || xrSession.value.interactionMode !== 'world-space' || scenePlacementMode.value !== 'placing')
      return

    for (const entity of inputSourceEntities) {
      if (!entity) return

      const inputSourceComponent = getComponent(entity, InputSourceComponent)

      const avatarInputSettings = getState(AvatarInputSettingsState)
      if (
        inputSourceComponent.source.targetRayMode !== 'tracked-pointer' ||
        inputSourceComponent.source.gamepad?.mapping !== 'xr-standard' ||
        inputSourceComponent.source.handedness !== avatarInputSettings.preferredHand
      )
        continue

      setVisibleComponent(originAnchorEntity, true)
      setComponent(scenePlacementEntity, XRHitTestComponent, {
        space: inputSourceComponent.source.targetRaySpace,
        entityTypes: ['plane', 'point', 'mesh']
      })
    }
  }, [scenePlacementMode, xrSession, inputSourceEntities.length])

  useEffect(() => {
    if (scenePlacementMode.value !== 'placing' || !xrSession.value) return
    const avatarInputSettings = getState(AvatarInputSettingsState)
    InputSourceComponent.captureAxes(scenePlacementEntity, [avatarInputSettings.preferredHand])
    InputSourceComponent.captureButtons(scenePlacementEntity, [avatarInputSettings.preferredHand])
    return () => {
      InputSourceComponent.releaseAxes()
      InputSourceComponent.releaseButtons()
    }
  }, [scenePlacementMode, xrSession])

  return null
}

export const XRAnchorSystem = defineSystem({
  uuid: 'ee.engine.XRAnchorSystem',
  insert: { after: ReferenceSpaceTransformSystem },
  execute,
  reactor
})

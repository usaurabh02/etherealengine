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

import { Matrix4, Quaternion, Vector3 } from 'three'

import { Engine } from '@etherealengine/engine/src/ecs/classes/Engine'
import { getComponent } from '@etherealengine/engine/src/ecs/functions/ComponentFunctions'
import { defineQuery } from '@etherealengine/engine/src/ecs/functions/QueryFunctions'

import { getState } from '@etherealengine/hyperflux'
import { CameraComponent } from '../../camera/components/CameraComponent'
import { V_010 } from '../../common/constants/MathConstants'
import { EngineState } from '../../ecs/classes/EngineState'
import { defineSystem } from '../../ecs/functions/SystemFunctions'
import { InputSourceComponent } from '../../input/components/InputSourceComponent'
import { InputState } from '../../input/state/InputState'
import { TransformComponent } from '../../transform/components/TransformComponent'
import { FlyControlComponent } from '../components/FlyControlComponent'
import { AvatarInputSystem } from './AvatarInputSystem'

const EPSILON = 10e-5
const IDENTITY = new Matrix4().identity()

const flyControlQuery = defineQuery([FlyControlComponent])
const direction = new Vector3()
const parentInverse = new Matrix4()
const tempVec3 = new Vector3()
const quat = new Quaternion()
const worldPos = new Vector3()
const worldQuat = new Quaternion()
const worldScale = new Vector3(1, 1, 1)
const candidateWorldQuat = new Quaternion()

const execute = () => {
  const nonCapturedInputSource = InputSourceComponent.nonCapturedInputSourceQuery()[0]
  if (!nonCapturedInputSource) return

  const inputSource = getComponent(nonCapturedInputSource, InputSourceComponent)

  if (!inputSource.buttons.SecondaryClick?.pressed && !inputSource.buttons.PrimaryClick?.pressed) return

  for (const entity of flyControlQuery()) {
    const flyControlComponent = getComponent(entity, FlyControlComponent)
    const camera = getComponent(Engine.instance.cameraEntity, CameraComponent)

    const inputState = inputSource.buttons

    const pointerState = getState(InputState).pointerState
    const mouseMovement = pointerState.movement

    camera.matrixWorld.decompose(worldPos, worldQuat, worldScale)

    // rotate about the camera's local x axis
    candidateWorldQuat.multiplyQuaternions(
      quat.setFromAxisAngle(
        tempVec3.set(1, 0, 0).applyQuaternion(worldQuat),
        mouseMovement.y * flyControlComponent.lookSensitivity
      ),
      worldQuat
    )

    // check change of local "forward" and "up" to disallow flipping
    const camUpY = tempVec3.set(0, 1, 0).applyQuaternion(worldQuat).y
    const newCamUpY = tempVec3.set(0, 1, 0).applyQuaternion(candidateWorldQuat).y
    const newCamForwardY = tempVec3.set(0, 0, -1).applyQuaternion(candidateWorldQuat).y
    const extrema = Math.sin(flyControlComponent.maxXRotation)
    const allowRotationInX =
      newCamUpY > 0 && ((newCamForwardY < extrema && newCamForwardY > -extrema) || newCamUpY > camUpY)

    if (allowRotationInX) {
      camera.matrixWorld.compose(worldPos, candidateWorldQuat, worldScale)
      // assume that if camera.parent exists, its matrixWorld is up to date
      parentInverse.copy(camera.parent ? camera.parent.matrixWorld : IDENTITY).invert()
      camera.matrix.multiplyMatrices(parentInverse, camera.matrixWorld)
      camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale)
    }

    camera.matrixWorld.decompose(worldPos, worldQuat, worldScale)
    // rotate about the world y axis
    candidateWorldQuat.multiplyQuaternions(
      quat.setFromAxisAngle(V_010, -mouseMovement.x * flyControlComponent.lookSensitivity),
      worldQuat
    )

    camera.matrixWorld.compose(worldPos, candidateWorldQuat, worldScale)
    camera.matrix.multiplyMatrices(parentInverse, camera.matrixWorld)
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale)

    const lateralMovement = (inputState.KeyD?.pressed ? 1 : 0) + (inputState.KeyA?.pressed ? -1 : 0)
    const forwardMovement = (inputState.KeyS?.pressed ? 1 : 0) + (inputState.KeyW?.pressed ? -1 : 0)
    const upwardMovement = (inputState.KeyE?.pressed ? 1 : 0) + (inputState.KeyQ?.pressed ? -1 : 0)

    // translate
    direction.set(lateralMovement, 0, forwardMovement)
    const boostSpeed = inputState.ShiftLeft?.pressed ? flyControlComponent.boostSpeed : 1
    const deltaSeconds = getState(EngineState).deltaSeconds
    const speed = deltaSeconds * flyControlComponent.moveSpeed * boostSpeed

    if (direction.lengthSq() > EPSILON) camera.translateOnAxis(direction, speed)

    camera.position.y += upwardMovement * deltaSeconds * flyControlComponent.moveSpeed * boostSpeed

    const transform = getComponent(Engine.instance.cameraEntity, TransformComponent)
    transform.position.copy(camera.position)
    transform.rotation.copy(camera.quaternion)
  }
}

export const FlyControlSystem = defineSystem({
  uuid: 'ee.engine.FlyControlSystem',
  insert: { after: AvatarInputSystem },
  execute
})

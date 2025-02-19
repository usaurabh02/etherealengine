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

import { getMutableState, getState, useHookstate } from '@etherealengine/hyperflux'

import { iOS } from '../../common/functions/isMobile'
import { EngineState } from '../../ecs/classes/EngineState'
import { getComponent } from '../../ecs/functions/ComponentFunctions'
import { defineQuery } from '../../ecs/functions/QueryFunctions'
import { RendererState } from '../../renderer/RendererState'
import { DirectionalLightComponent } from '../../scene/components/DirectionalLightComponent'
import { isMobileXRHeadset } from '../../xr/XRState'
import { EngineRenderer, RenderSettingsState } from '../WebGLRendererSystem'
import { RenderModes } from '../constants/RenderModes'

export const getShadowsEnabled = () => {
  const rendererState = getState(RendererState)
  const isEditor = getState(EngineState).isEditor
  return (
    !isMobileXRHeadset &&
    !iOS &&
    rendererState.useShadows &&
    (isEditor ? rendererState.renderMode === RenderModes.SHADOW : true)
  )
}

export const useShadowsEnabled = () => {
  const rendererState = getMutableState(RendererState)
  const useShadows = useHookstate(rendererState.useShadows).value
  const renderMode = useHookstate(rendererState.renderMode).value
  const isEditor = useHookstate(getMutableState(EngineState).isEditor).value
  return !isMobileXRHeadset && !iOS && useShadows && (isEditor ? renderMode === RenderModes.SHADOW : true)
}

const directionalLightQuery = defineQuery([DirectionalLightComponent])

export const updateShadowMap = () => {
  const enabled = getShadowsEnabled()

  if (!enabled) return

  const type = getState(RenderSettingsState).shadowMapType
  EngineRenderer.instance.renderer.shadowMap.type = type
  EngineRenderer.instance.renderer.shadowMap.needsUpdate = true

  for (const entity of directionalLightQuery()) {
    const directionalLight = getComponent(entity, DirectionalLightComponent)
    if (directionalLight.light.shadow) {
      directionalLight.light.shadow.map?.dispose()
      directionalLight.light.shadow.map = null as any
      directionalLight.light.shadow.camera.updateProjectionMatrix()
      directionalLight.light.shadow.needsUpdate = true
    }
  }
}

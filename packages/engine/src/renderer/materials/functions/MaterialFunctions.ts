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

import multiLogger from '@etherealengine/engine/src/common/functions/logger'
import { getState } from '@etherealengine/hyperflux'

import { getComponent } from '../../../ecs/functions/ComponentFunctions'
import { defineQuery } from '../../../ecs/functions/QueryFunctions'
import { MeshComponent } from '../../../scene/components/MeshComponent'
import { MaterialLibraryState } from '../MaterialLibrary'

const meshQuery = defineQuery([MeshComponent])

export function dedupMaterials() {
  const materialTable = Object.entries(getState(MaterialLibraryState).materials)
  materialTable.map(([uuid, materialComponent], i) => {
    for (let j = 0; j < i; j++) {
      const [uuid2, materialComponent2] = materialTable[j]
      if (
        materialComponent.prototype === materialComponent2.prototype &&
        Object.entries(materialComponent.parameters).every(([k, v]) => {
          const v2 = materialComponent2.parameters[k]
          if (!([null, undefined] as any[]).includes(v) && typeof v2?.equals === 'function') {
            return v2.equals(v)
          }
          return v2 === v
        })
      ) {
        multiLogger.info('found duplicate material')
        //change every instance of material1 to material2
        for (const entity of meshQuery()) {
          const mesh = getComponent(entity, MeshComponent)
          if (!mesh?.isMesh) return
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          materials.map((material, i) => {
            if (!Array.isArray(mesh.material)) {
              mesh.material = material === materialComponent.material ? materialComponent2.material : material
            } else {
              mesh.material = mesh.material.map((material) =>
                material === materialComponent.material ? materialComponent2.material : material
              )
            }
          })
        }
      }
    }
  })
}

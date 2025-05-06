/*
CPAL-1.0 License

The contents of this file are subject to the Common Public Attribution License
Version 1.0. (the "License"); you may not use this file except in compliance
with the License. You may obtain a copy of the License at
https://github.com/ir-engine/ir-engine/blob/dev/LICENSE.
The License is based on the Mozilla Public License Version 1.1, but Sections 14
and 15 have been added to cover use of software over a computer network and
provide for limited attribution for the Original Developer. In addition,
Exhibit A has been modified to be consistent with Exhibit B.

Software distributed under the License is distributed on an "AS IS" basis,
WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the
specific language governing rights and limitations under the License.

The Original Code is Infinite Reality Engine.

The Original Developer is the Initial Developer. The Initial Developer of the
Original Code is the Infinite Reality Engine team.

All portions of the code written by the Infinite Reality Engine team are Copyright © 2021-2023
Infinite Reality Engine. All Rights Reserved.
*/

import { Effect, EffectComposer, EffectPass, NormalPass, OutlineEffect, Pass, RenderPass } from 'postprocessing'
import { Scene, WebGLRenderer } from 'three'

import { Entity, defineComponent, getComponent } from '@ir-engine/ecs'
import { S } from '@ir-engine/ecs/src/schemas/JSONSchemas'
import { none } from '@ir-engine/hyperflux'

import { WebXRManager } from '../../xr/WebXRManager'
import { ObjectLayers } from '../constants/ObjectLayers'
import { CSM } from '../csm/CSM'
import CSMHelper from '../csm/CSMHelper'

// Define the EffectSchema
export const EffectSchema = S.Union([S.Any(), S.Type<Effect>(undefined, { isActive: S.Bool() })])

type PassCount = {
  pass: Pass
  count: number
}

export const RendererComponent = defineComponent({
  name: 'RendererComponent',

  schema: S.Object(
    {
      /** Is resize needed? */
      needsResize: S.Bool({ default: false }),

      renderPass: S.Type<RenderPass | null>(),
      normalPass: S.Type<NormalPass | null>(),
      passes: S.Record(S.String(), S.Type<Pass>()),
      passesFakeMap: S.Record(S.String(), S.Type<PassCount>()),

      renderContext: S.Type<WebGLRenderingContext | null | WebGL2RenderingContext>(),
      effects: S.Record(S.String(), EffectSchema),
      effectInstances: S.Record(S.String(), S.Type<Effect>()),

      canvas: S.Type<HTMLCanvasElement | null>(),

      renderer: S.Type<WebGLRenderer | null>(),
      effectComposer: S.Type<EffectComposer | null>(),

      scenes: S.Array(S.Entity()),
      scene: S.Class(() => new Scene()),

      /** @todo deprecate and replace with engine implementation */
      xrManager: S.Type<WebXRManager | null>(),
      webGLLostContext: S.Type<WEBGL_lose_context | null>(),

      csm: S.Type<CSM | null>(),
      csmHelper: S.Type<CSMHelper | null>()
    },
    { serialized: false }
  ),

  onInit(initial) {
    initial.scene.matrixAutoUpdate = false
    initial.scene.matrixWorldAutoUpdate = false
    initial.scene.layers.set(ObjectLayers.Scene)
    return initial
  },

  //TODO finish hashing this out
  /**
   * Returns whether a postprocessing render pass is already registered (uses reference counting)
   * @param entity
   * @param passType
   */
  passExists<T extends Pass>(entity: Entity, passType: new (...args: any[]) => T): boolean {
    //return class name as string from constructor implicit name
    const key = passType.name

    const rendererComponent = getComponent(entity, RendererComponent)
    const count = rendererComponent.passesFakeMap[key] ? rendererComponent.passesFakeMap[key].count : 0
    return count > 0
  },

  getPass<T extends Pass>(entity: Entity, passType: new (...args: any[]) => T): T {
    //return class name as string from constructor implicit name
    const key = passType.name

    const rendererComponent = getComponent(entity, RendererComponent)
    return rendererComponent.passesFakeMap[key].pass as T
  },

  /**
   * Registers a postprocessing render pass, and either creates a new instance or increments the reference count of the existing one.
   * @param rendererEntity entity of the RendererComponent
   * @param passType The type of pass to be registered, uses this as a unique key
   * @param passFunction A function that returns a new instance of the pass (for custom initialization needs)
   * @returns The pass instance
   */
  registerPass<T extends Pass>(
    rendererEntity: Entity,
    passType: new (...args: any[]) => T,
    passFunction: (rendererEntity: Entity) => Pass
  ): T {
    //return class name as string from constructor implicit name
    const key = passType.name

    const rendererComponent = getComponent(rendererEntity, RendererComponent)
    if (rendererComponent.passesFakeMap[key]) {
      const count = rendererComponent.passesFakeMap[key].count
      const existingPass = rendererComponent.passesFakeMap[key].pass
      rendererComponent.passesFakeMap[key] = { pass: existingPass, count: count + 1 }
    } else {
      const generatedPass = passFunction(rendererEntity)
      rendererComponent.passesFakeMap[key] = { pass: generatedPass, count: 1 }
    }
    return rendererComponent.passesFakeMap[key].pass as T
  },

  /**
   * Unregisters a postprocessing render pass, and either decrements the reference count or removes the pass entirely.
   * @param entity entity of the RendererComponent
   * @param passType The type of pass to be unregistered, uses this as a unique key
   */
  unregisterPass<T extends Pass>(entity: Entity, passType: new (...args: any[]) => T) {
    //return class name as string from constructor implicit name
    const key = passType.name

    const rendererComponent = getComponent(entity, RendererComponent)
    const count = rendererComponent.passesFakeMap[key].count
    if (count > 1) {
      rendererComponent.passesFakeMap[key].count = count - 1
    } else {
      const effectComposerState = rendererComponent.effectComposer as EffectComposer
      const pass = RendererComponent.getPass(entity, passType)
      effectComposerState.removePass(pass)
      rendererComponent.passesFakeMap[key] = none
      delete rendererComponent.passesFakeMap[key]
    }
  }
})

// Add the postprocessing module declarations
declare module 'postprocessing' {
  interface EffectComposer {
    EffectPass: EffectPass
    OutlineEffect: OutlineEffect
  }
  interface Effect {
    isActive: boolean
  }
}

<template>
  <view></view>
</template>

<script lang="uts">
  import FrameLayout from 'android.widget.FrameLayout';
  import { XycNativeCameraView } from 'uts.xyc.markvideo.android';

  export default {
    name: 'xyc-markvideo',
    emits: [
      'nativeviewready',
      'cameraready',
      'nativeerror',
      'photodone',
      'recordstart',
      'recorddone',
      'flashchange',
      'zoomchange'
    ],
    props: {
      mode: {
        type: String,
        default: 'photo'
      },
      targetFps: {
        type: Number,
        default: 30
      },
      statusText: {
        type: String,
        default: 'XYC native camera preview'
      }
    },
    data() {
      return {
        cameraView: null as XycNativeCameraView | null,
        cameraViewLoaded: false
      }
    },
    watch: {
      statusText: {
        handler(newValue : string, oldValue : string) {
          if (newValue != oldValue) {
            this.setStatus(newValue);
          }
        },
        immediate: false
      },
      mode: {
        handler(newValue : string, oldValue : string) {
          if (newValue != oldValue) {
            this.switchMode(newValue);
          }
        },
        immediate: false
      },
      targetFps: {
        handler(newValue : number, oldValue : number) {
          if (newValue != oldValue && this.cameraView != null) {
            this.cameraView!.setTargetFps(newValue.toInt());
          }
        },
        immediate: false
      }
    },
    expose: ['setStatus', 'switchMode', 'setFlashMode', 'setZoomMode', 'setWatermark', 'clearWatermark', 'takePhoto', 'startRecord', 'stopRecord', 'restartCamera', 'preparePermissions', 'prepareRecordPermissions', 'destroyCamera'],
    methods: {
      emitNativeEvent(eventName : string, payload : any) {
        if (eventName == 'cameraready') {
          this.$emit('cameraready', payload);
          return;
        }
        if (eventName == 'nativeerror') {
          this.$emit('nativeerror', payload);
          return;
        }
        if (eventName == 'photodone') {
          this.$emit('photodone', payload);
          return;
        }
        if (eventName == 'recordstart') {
          this.$emit('recordstart', payload);
          return;
        }
        if (eventName == 'recorddone') {
          this.$emit('recorddone', payload);
          return;
        }
        if (eventName == 'flashchange') {
          this.$emit('flashchange', payload);
          return;
        }
        if (eventName == 'zoomchange') {
          this.$emit('zoomchange', payload);
        }
      },
      resolveCameraView() : XycNativeCameraView | null {
        if (this.cameraView != null) {
          return this.cameraView;
        }
        return null;
      },
      requireCameraView() : XycNativeCameraView | null {
        const view = this.resolveCameraView();
        if (view != null) {
          return view;
        }
        this.$emit('nativeerror', {
          errorCode: '9001',
          errorMessage: '原生相机组件不可用',
          nativeMessage: 'XycNativeCameraView is not loaded.'
        });
        return null;
      },
      setStatus(text : string) {
        const view = this.resolveCameraView();
        if (view != null) {
          view.setStatus(text);
        }
      },
      switchMode(mode : string) : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.switchMode(mode);
      },
      setFlashMode(mode : string) : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.setFlashMode(mode);
      },
      setZoomMode(mode : string) : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.setZoomMode(mode);
      },
      setWatermark(template : any) : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.setWatermark(encode(template));
      },
      clearWatermark() : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.clearWatermark();
      },
      takePhoto() : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.takePhoto();
      },
      startRecord(options : any = {}) : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.startRecord(encode(options));
      },
      stopRecord() : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.stopRecord();
      },
      restartCamera() : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.restartCamera();
      },
      preparePermissions() : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.preparePermissions();
      },
      prepareRecordPermissions() : string {
        const view = this.requireCameraView();
        if (view == null) {
          return nativeViewUnavailable();
        }
        return view.prepareRecordPermissions();
      },
      destroyCamera() : string {
        const view = this.resolveCameraView();
        if (view == null) {
          this.cameraViewLoaded = false;
          return ok({});
        }
        const result = view.destroyCamera();
        this.cameraView = null;
        this.cameraViewLoaded = false;
        return result;
      }
    },
    NVLoad() : FrameLayout {
      const view = new XycNativeCameraView($androidContext!);
      view.setEventCallback((eventName : string, payloadText : string) => {
        this.emitNativeEvent(eventName, parseObject(payloadText));
      });
      view.setMode(this.mode);
      view.setTargetFps(this.targetFps.toInt());
      view.setStatus(this.statusText);
      this.cameraView = view;
      this.cameraViewLoaded = true;
      return view;
    },
    NVLoaded() {
      this.$emit('nativeviewready');
    }
  }

  function ok(data : any) : string {
    return JSON.stringify({
      success: true,
      errorCode: '',
      errorMessage: '',
      nativeMessage: '',
      data: data
    }) ?? '{}';
  }

  function nativeViewUnavailable() : string {
    return JSON.stringify({
      success: false,
      errorCode: '9001',
      errorMessage: '原生相机组件不可用',
      nativeMessage: 'XycNativeCameraView is not loaded.',
      data: {}
    }) ?? '{}';
  }

  function parseObject(text : string) : any {
    try {
      return JSON.parse(text) ?? {};
    } catch (_) {
      return {};
    }
  }

  function parseResult(text : string) : UTSJSONObject {
    try {
      const result = JSON.parseObject(text);
      if (result != null) {
        const rawData = result.get('data');
        return {
          success: result.getBoolean('success') == true,
          errorCode: result.getString('errorCode', ''),
          errorMessage: result.getString('errorMessage', ''),
          nativeMessage: result.getString('nativeMessage', ''),
          data: rawData == null ? {} : rawData
        };
      }
      return {
        success: false,
        errorCode: '9001',
        errorMessage: '原生返回结构无效',
        nativeMessage: 'JSON.parse returned null',
        data: {}
      };
    } catch (error) {
      return {
        success: false,
        errorCode: '9001',
        errorMessage: '原生返回结构无效',
        nativeMessage: `${error}`,
        data: {}
      };
    }
  }

  function encode(value : any) : string {
    return JSON.stringify(value ?? {}) ?? '{}';
  }
</script>

<style>
</style>

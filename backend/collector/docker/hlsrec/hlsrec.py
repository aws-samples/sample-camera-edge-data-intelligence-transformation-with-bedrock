from datetime import datetime, timedelta, timezone
from fractions import Fraction
import boto3
from botocore.exceptions import NoCredentialsError, ClientError, EndpointConnectionError
import av
import click
from PIL import Image
import io
import time
import uuid
import logging
import os
import threading
import numpy as np
from queue import Queue
from concurrent.futures import ThreadPoolExecutor
import atexit

# shared.commonから共通関数をインポート
from shared.common import *
from shared.eventbridge_publisher import EventBridgePublisher

from shared.hls_connector import HlsConnectorFactory

# 環境変数の取得
COLLECTOR_ID = os.environ.get('COLLECTOR_ID')
if not COLLECTOR_ID:
    print("ERROR: COLLECTOR_ID環境変数が設定されていません。")
    import sys
    sys.exit(1)

# ロガーの設定
logger = setup_logger(__name__)

# ===== ThreadPoolExecutorの設定 =====
# 画像アップロード用（軽量・頻繁）
image_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="image_upload")

# 動画エンコード用（重量・低頻度）
video_encode_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="video_encode")

# 動画アップロード用（中量・低頻度）
video_upload_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="video_upload")

def cleanup_executors():
    """プログラム終了時にスレッドプールをクリーンアップ"""
    try:
        logger.info("スレッドプールをシャットダウンしています（atexit）...")
        # shutdown()は複数回呼んでも安全
        image_executor.shutdown(wait=True, cancel_futures=False)
        video_encode_executor.shutdown(wait=True, cancel_futures=False)
        video_upload_executor.shutdown(wait=True, cancel_futures=False)
        logger.info("スレッドプールのシャットダウン完了（atexit）")
    except Exception as e:
        logger.error(f"スレッドプールのクリーンアップエラー: {e}")

# プログラム終了時にクリーンアップを実行
atexit.register(cleanup_executors)

def encode_video_from_buffer(frame_buffer, video_start_time, video_end_time, camera_id, bucket_name, s3, dynamodb, width, height, fps, event_publisher=None):
    """
    バッファリングされたフレームから動画をエンコードしてS3に保存
    
    Args:
        frame_buffer: NumPy配列のリスト（各フレーム）
        video_start_time: 動画開始時刻
        video_end_time: 動画終了時刻
        camera_id: カメラID
        bucket_name: S3バケット名
        s3: S3クライアント
        dynamodb: DynamoDBリソース
        width: 動画の幅
        height: 動画の高さ
        fps: フレームレート
    """
    # セキュアな一時ディレクトリを作成
    import tempfile
    import shutil
    temp_dir = tempfile.mkdtemp(prefix='video_encode_')
    output_path = os.path.join(temp_dir, f'video_{camera_id}_{uuid.uuid4().hex[:8]}.mp4')
    
    try:
        logger.info(f"バッファから動画エンコード開始: {len(frame_buffer)}フレーム, {output_path}")
        
        # 出力コンテナを開く
        output_container = av.open(output_path, 'w')
        
        # H.264エンコーダを作成
        output_stream = output_container.add_stream('h264', rate=fps)
        output_stream.width = width
        output_stream.height = height
        output_stream.pix_fmt = 'yuv420p'
        
        # time_baseを固定値として設定（1ms単位）
        from fractions import Fraction
        FIXED_TIME_BASE = Fraction(1, 1000)
        output_stream.time_base = FIXED_TIME_BASE
        
        # エンコーダオプション
        output_stream.options = {
            'crf': '23',
            'preset': 'ultrafast',
        }
        
        # フレームをエンコード
        successful_frames = 0
        failed_frames = 0
        
        for idx, frame_array in enumerate(frame_buffer):
            try:
                # NumPy配列からAVフレームを作成（既にyuv420p形式）
                frame = av.VideoFrame.from_ndarray(frame_array, format='yuv420p')
                
                # PTSを正しく計算（time_base=1/1000の場合、フレーム時間をミリ秒で表現）
                frame.pts = int(idx * 1000 / fps)
                # time_baseは固定値を使用（reformat後に変わらないように）
                frame.time_base = FIXED_TIME_BASE
                
                # 最初の数フレームだけPTS値をログ出力
                if idx <= 10:
                    logger.info(f"フレーム#{idx}: PTS={frame.pts}, time_base={frame.time_base}, fps={fps}")
                
                # エンコードとmux（両方をtryでラップ）
                try:
                    for packet in output_stream.encode(frame):
                        output_container.mux(packet)
                    successful_frames += 1
                except Exception as mux_error:
                    failed_frames += 1
                    if failed_frames <= 10:  # ログを10件に増やす
                        logger.warning(f"フレーム#{idx}のmuxに失敗（スキップ）: PTS={frame.pts}, {mux_error}")
                
            except Exception as e:
                failed_frames += 1
                if failed_frames <= 5:  # 最初の5エラーだけログ
                    logger.warning(f"フレーム#{idx}のエンコードに失敗（スキップ）: {e}")
        
        # 残りのパケットをフラッシュ（エラーハンドリング付き）
        try:
            for packet in output_stream.encode():
                try:
                    output_container.mux(packet)
                except Exception as flush_error:
                    logger.warning(f"フラッシュ中のmuxエラー（スキップ）: {flush_error}")
        except Exception as e:
            logger.warning(f"フラッシュ処理エラー: {e}")
        
        # コンテナを閉じる
        try:
            output_container.close()
        except Exception as e:
            logger.warning(f"コンテナclose時のエラー: {e}")
        
        logger.info(f"動画エンコード完了: 成功={successful_frames}, 失敗={failed_frames}")
        
        # S3にアップロード（別スレッドで実行してエンコードと並列化）
        if successful_frames > 0:
            video_upload_executor.submit(
                async_upload_video,
                output_path, video_start_time, video_end_time,
                camera_id, bucket_name, s3, dynamodb, event_publisher
            )
        else:
            logger.error("エンコードに成功したフレームがありません")
            
    except Exception as e:
        logger.error(f"動画エンコード処理中にエラー: {e}")
        import traceback
        logger.error(traceback.format_exc())
    finally:
        # 一時ディレクトリをクリーンアップ
        # 注意: S3アップロードは別スレッドで実行されるため、
        # アップロード完了後に削除される（async_upload_video 内で処理）
        # ここではエラー時のクリーンアップのみ
        pass

def async_upload_image(img_byte_arr, s3_key, s3path, current_time, camera_id, bucket_name, s3, dynamodb, event_publisher=None):
    """
    画像アップロードとDynamoDB挿入を非同期実行（疎結合: detector を知らない）
    
    Args:
        img_byte_arr: JPEG画像のバイトデータ
        s3_key: S3キー
        s3path: S3パス（ログ用）
        current_time: キャプチャ時刻
        camera_id: カメラID
        bucket_name: S3バケット名
        s3: S3クライアント
        dynamodb: DynamoDBリソース
        event_publisher: EventBridgePublisher（オプション）
    """
    try:
        if upload_to_s3_with_retry(s3, bucket_name, s3_key, img_byte_arr):
            logger.info(f"画像をS3にアップロードしました: {s3path}")
            file_id = insert_file_record(dynamodb, camera_id, current_time, current_time, s3path, COLLECTOR_ID, 'image')
            if file_id:
                logger.info(f"ファイルレコードをDynamoDBに保存しました: {file_id}")
                
                # EventBridge イベント発行（疎結合: 1回のみ）
                if event_publisher:
                    try:
                        event_publisher.publish_save_image_event(
                            camera_id=camera_id,
                            collector_id=COLLECTOR_ID,
                            file_id=file_id,
                            s3path=s3path,
                            timestamp=current_time
                        )
                        logger.info(f"SaveImageEvent発行完了: collector_id={COLLECTOR_ID}")
                    except Exception as e:
                        logger.error(f"EventBridge発行エラー: {e}")
                        # エラーでもメイン処理は継続
    except Exception as e:
        logger.error(f"非同期画像アップロードエラー: {e}")
        import traceback
        logger.error(traceback.format_exc())

def async_capture_and_save_image(frame_image, current_time, camera_id, bucket_name, s3, dynamodb):
    """
    capture.jpegの更新を非同期実行
    
    Args:
        frame_image: PIL Image
        current_time: 現在時刻
        camera_id: カメラID
        bucket_name: S3バケット名
        s3: S3クライアント
        dynamodb: DynamoDBリソース
    """
    try:
        img_byte_arr = io.BytesIO()
        frame_image.save(img_byte_arr, format='JPEG')
        img_byte_arr = img_byte_arr.getvalue()

        s3_key = f"collect/{camera_id}/capture.jpg"
        s3path = f"s3://{bucket_name}/{s3_key}"

        upload_to_s3_with_retry(s3, bucket_name, s3_key, img_byte_arr)
        logger.info(f"capture.jpegを更新しました: {s3path}")

        # DynamoDBのcapture列を更新
        update_camera_capture_image(dynamodb, camera_id, s3path)
        
    except Exception as e:
        logger.error(f"capture.jpeg更新エラー: {e}")
        import traceback
        logger.error(traceback.format_exc())

def async_upload_video(video_path, start_time, end_time, camera_id, bucket_name, s3, dynamodb, event_publisher=None):
    """
    動画をS3にアップロードしDynamoDBに記録（非同期実行用、疎結合: detector を知らない）
    
    Args:
        video_path: 一時ファイルのパス
        start_time: 動画の開始時刻
        end_time: 動画の終了時刻
        camera_id: カメラID
        bucket_name: S3バケット名
        s3: S3クライアント
        dynamodb: DynamoDBリソース
        event_publisher: EventBridgePublisher（オプション）
    """
    try:
        # 動画ファイルを読み込む
        with open(video_path, 'rb') as f:
            video_data = f.read()
        
        logger.info(f"動画ファイル読み込み完了: {len(video_data)/1024/1024:.1f} MB")
        
        # S3に保存 - collector_id を使用
        s3_key, s3path = generate_s3_path(camera_id, COLLECTOR_ID, 'video', start_time, bucket_name, 'mp4')
        
        s3.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=video_data,
            ContentType='video/mp4'
        )
        
        logger.info(f"動画を保存しました: {s3path}")
        
        # DynamoDBにファイルレコードを挿入
        file_id = insert_file_record(dynamodb, camera_id, start_time, end_time, s3path, COLLECTOR_ID, 'video')
        
        if file_id:
            logger.info(f"動画レコード保存完了: {file_id}")
            
            # EventBridge イベント発行（疎結合: 1回のみ）
            if event_publisher:
                try:
                    # 動画の長さ（秒）を計算
                    duration = (end_time - start_time).total_seconds()
                    event_publisher.publish_save_video_event(
                        camera_id=camera_id,
                        collector_id=COLLECTOR_ID,
                        file_id=file_id,
                        s3path=s3path,
                        timestamp=end_time,
                        video_duration=duration
                    )
                    logger.info(f"SaveVideoEvent発行完了: collector_id={COLLECTOR_ID}")
                except Exception as e:
                    logger.error(f"EventBridge発行エラー: {e}")
                    # エラーでもメイン処理は継続
        else:
            logger.error("DynamoDBレコード作成に失敗")
            
    except Exception as e:
        logger.error(f"動画アップロードエラー: {e}")
        import traceback
        logger.error(traceback.format_exc())
    finally:
        # 一時ファイルと一時ディレクトリを削除
        try:
            if os.path.exists(video_path):
                os.remove(video_path)
                logger.info(f"一時ファイルを削除しました: {video_path}")
                
                # 親ディレクトリも削除（空の場合）
                import shutil
                parent_dir = os.path.dirname(video_path)
                if os.path.exists(parent_dir) and os.path.isdir(parent_dir):
                    try:
                        shutil.rmtree(parent_dir)
                        logger.info(f"一時ディレクトリを削除しました: {parent_dir}")
                    except Exception as dir_e:
                        logger.warning(f"一時ディレクトリ削除エラー: {dir_e}")
        except Exception as e:
            logger.warning(f"一時ファイル削除エラー: {e}")

def process_hls_stream(camera_id: str, interval: int, duration: int, bucket_name: str) -> None:
    """
    AWS Kinesis Video StreamsのHLSストリームから定期的に画像をキャプチャし、S3に保存します
    
    Args:
        camera_id: カメラID
        interval: 画像キャプチャ間隔（秒）- DBから取得した値で上書きされます
        duration: キャプチャ実行時間（秒）、0の場合は無期限 - DBから取得した値で上書きされます
        bucket_name: S3バケット名
    
    Note:
        設定変更時はAPIがECSタスクを停止し、サービスが自動的に再起動する。
        起動時にDynamoDBから最新設定を読み込むため、ポーリングは不要。
    """
    try:
        # コレクター設定を環境変数COLLECTOR_IDから取得
        from shared.database import get_collector_by_id
        
        collector_settings = get_collector_by_id(COLLECTOR_ID)
        if not collector_settings:
            logger.error(f"Collector not found: {COLLECTOR_ID}")
            return
        
        logger.info(f"Collector settings: {collector_settings}")
        
        # DBから取得した値を使用（引数は無視）
        interval = int(collector_settings.get('capture_image_interval', 5000))
        video_duration = int(collector_settings.get('capture_video_duration', 60))
        collector_mode = collector_settings.get('collector_mode', 'image')
        
        # キャプチャモードの判定
        capture_images = collector_mode in ['image', 'image_and_video']
        capture_videos = collector_mode in ['video', 'image_and_video']
        
        logger.info(f"Using interval: {interval}s, video duration: {video_duration}s, mode: {collector_mode}")
        logger.info(f"Capture settings - Images: {capture_images}, Videos: {capture_videos}")
        
        # EventBridgePublisherを初期化（疎結合: detector を知らない）
        event_publisher = None
        try:
            event_publisher = EventBridgePublisher(
                create_boto3_session_func=create_boto3_session,
                collector_type='hlsRec',
                event_bus_name=os.environ.get('EVENT_BUS_NAME', 'default')
            )
            logger.info(f"EventBridgePublisher初期化完了: collector_id={COLLECTOR_ID}")
        except Exception as e:
            logger.warning(f"EventBridgePublisher初期化に失敗しました（処理は継続）: {e}")
            event_publisher = None
        
        # 注意: duration引数は全体の処理時間（0=無限）、video_durationは個々の動画の長さ
        # main関数からduration=0で呼ばれるため、無限ループで動作する
        
        # AWS クライアントの初期化
        s3 = get_s3_client()
        dynamodb = get_dynamodb_resource()
        
        # カメラ情報の取得
        camera_info = get_camera_info(camera_id)
        if not camera_info:
            logger.error(f"エラー: カメラID '{camera_id}' が見つかりません")
            return
        
        log_camera_info(camera_info)

        # HLSコネクターを作成してURLを取得
        try:
            connector = HlsConnectorFactory.create_from_info(camera_info, logger)
            hls_url, av_options = connector.get_hls_url()
        except ValueError as e:
            logger.error(f"コネクター作成エラー: {e}")
            return
        except Exception as e:
            logger.error(f"HLS URL取得エラー: {e}")
            return

        # pyavによりHLSストリームを開く
        container = av.open(hls_url, options=av_options)
        video_stream = container.streams.video[0]

        # 入力ストリームの情報を表示
        logger.info(f"入力ストリーム情報:")
        logger.info(f"  - コーデック: {video_stream.codec_context.name}")
        logger.info(f"  - プロファイル: {video_stream.codec_context.profile}")
        logger.info(f"  - 解像度: {video_stream.width}x{video_stream.height}")
        logger.info(f"  - フレームレート: {video_stream.average_rate}")
        logger.info(f"  - ピクセルフォーマット: {video_stream.pix_fmt}")
        logger.info(f"  - タイムベース: {video_stream.time_base}")

        # 開始時刻を記録
        from shared.timezone_utils import now_utc
        start_time = now_utc()
        last_capture_time = None
        last_capture_jpeg_time = None  # capture.jpeg更新用のタイマー
        capture_jpeg_interval = 600  # 10分間隔（秒）
        frame_count = 0
        
        # 動画録画用の変数（バッファリング方式）
        video_frame_buffer = []  # フレームをNumPy配列として保存
        video_start_time = None
        video_width = video_stream.width
        video_height = video_stream.height
        video_fps = int(video_stream.average_rate) if video_stream.average_rate else 30

        # 入力ストリーム内のフレームを取得
        try:
            for frame in container.decode(video=0):
                current_time = now_utc()
                
                # 指定時間経過で終了（duration > 0の場合のみ）
                # 通常はduration=0で無限ループ、video_durationで個々の動画を制御
                if duration > 0 and (current_time - start_time).total_seconds() >= duration:
                    logger.info(f"指定時間（{duration}秒）経過のため処理を終了します")
                    break
                
                # 最初のフレームの処理
                if frame_count == 0:
                    logger.info(f"最初のフレーム情報:")
                    logger.info(f"  - タイプ: {frame.pict_type}")
                    logger.info(f"  - キーフレーム: {frame.key_frame}")
                    logger.info(f"  - PTS: {frame.pts}")
                    logger.info(f"  - DTS: {frame.dts}")
                    last_capture_time = current_time
                    last_capture_jpeg_time = current_time

                    # 初回のcapture.jpegを保存（非同期）
                    frame_image = frame.to_image()
                    image_executor.submit(
                        async_capture_and_save_image,
                        frame_image, current_time, camera_id, bucket_name, s3, dynamodb
                    )

                # === 動画録画処理（バッファリング方式） ===
                if capture_videos:
                    # 動画録画開始
                    if video_start_time is None:
                        video_start_time = current_time
                        video_frame_buffer = []
                        logger.info(f"動画バッファリング開始 (FPS: {video_fps}, 解像度: {video_width}x{video_height})")
                    
                    # フレームをNumPy配列に変換してバッファに追加
                    try:
                        # フォーマット変換なし（yuv420pのまま）で高速化
                        frame_yuv = frame.to_ndarray(format='yuv420p')
                        video_frame_buffer.append(frame_yuv)
                        
                        # 最初の数フレームだけログ
                        if len(video_frame_buffer) <= 3:
                            logger.info(f"フレームバッファリング成功: #{len(video_frame_buffer)}, shape={frame_yuv.shape}")
                            
                    except Exception as e:
                        logger.warning(f"フレームバッファリングエラー: {e}")
                    
                    # 指定時間経過したらエンコードスレッドを起動
                    if (current_time - video_start_time).total_seconds() >= video_duration:
                        video_end_time = current_time
                        buffer_copy = video_frame_buffer.copy()  # バッファのコピーを作成
                        
                        logger.info(f"動画バッファリング完了: {len(buffer_copy)}フレーム, {video_duration}秒")
                        
                        # ThreadPoolExecutorで非同期エンコード処理を実行
                        video_encode_executor.submit(
                            encode_video_from_buffer,
                            buffer_copy, video_start_time, video_end_time, 
                            camera_id, bucket_name, s3, dynamodb, 
                            video_width, video_height, video_fps, event_publisher
                        )
                        
                        # 次の録画のためリセット
                        video_start_time = None
                        video_frame_buffer = []

                # 10分間隔でcapture.jpegを更新（非同期）
                if last_capture_jpeg_time is None or (current_time - last_capture_jpeg_time).total_seconds() >= capture_jpeg_interval:
                    # フレームをPIL Imageに変換してから非同期実行
                    frame_image = frame.to_image()
                    image_executor.submit(
                        async_capture_and_save_image,
                        frame_image, current_time, camera_id, bucket_name, s3, dynamodb
                    )
                    last_capture_jpeg_time = current_time

                # 指定間隔で画像をキャプチャ（通常のキャプチャ処理・非同期）
                if capture_images and (last_capture_time is None or (current_time - last_capture_time).total_seconds() >= interval):
                    # フレームをPIL Imageに変換
                    img = frame.to_image()
                    
                    # 画像をメモリに保存
                    img_byte_arr = io.BytesIO()
                    img.save(img_byte_arr, format='JPEG')
                    img_byte_arr = img_byte_arr.getvalue()

                    # S3パスを生成 - collector_id を使用
                    s3_key, s3path = generate_s3_path(camera_id, COLLECTOR_ID, 'image', current_time, bucket_name, 'jpeg')
                    
                    # アップロードを非同期実行（メインループをブロックしない）
                    image_executor.submit(
                        async_upload_image,
                        img_byte_arr, s3_key, s3path, current_time, 
                        camera_id, bucket_name, s3, dynamodb, event_publisher
                    )
                        
                    last_capture_time = current_time

                frame_count += 1
                if frame_count % 100 == 0:
                    logger.info(f"処理済みフレーム数: {frame_count}")

        except Exception as e:
            logger.error(f"フレーム処理中にエラーが発生しました: {e}")
            raise
        finally:
            # バッファに残っているフレームがあれば処理
            if capture_videos and video_start_time is not None and len(video_frame_buffer) > 0:
                try:
                    logger.info(f"処理終了のため、バッファリング中の動画を保存します: {len(video_frame_buffer)}フレーム")
                    video_end_time = now_utc()
                    
                    # ThreadPoolExecutorで非同期エンコード処理を実行
                    future = video_encode_executor.submit(
                        encode_video_from_buffer,
                        video_frame_buffer.copy(), video_start_time, video_end_time, 
                        camera_id, bucket_name, s3, dynamodb, 
                        video_width, video_height, video_fps, event_publisher
                    )
                    
                    # エンコード完了を待機（最大30秒）
                    try:
                        future.result(timeout=30)
                        logger.info("終了時の動画エンコード完了")
                    except Exception as e:
                        logger.error(f"終了時の動画エンコードタイムアウトまたはエラー: {e}")
                        
                except Exception as e:
                    logger.error(f"終了時の動画保存エラー: {e}")
            
            # 注意: スレッドプールはグローバルなので、ここではシャットダウンしない
            # 再試行時に再利用するため、atexitで最終的にクリーンアップする
            logger.info("処理を終了します（スレッドプールは再利用のため維持）")

    except Exception as e:
        logger.error(f"エラーが発生しました: {e}")
        logger.error(f"エラーの詳細: {str(e)}")
        raise


@click.command()
@click.option("--camera_id", type=str, required=True, envvar="CAMERA_ID", help="カメラID")
@click.option("--bucket_name", type=str, required=True, envvar="BUCKET_NAME", help="S3バケット名")
def streaming(camera_id: str, bucket_name: str) -> None:
    """
    HLSストリーム（Kinesis Video StreamsまたはVSaaS）から定期的に画像をキャプチャし、S3に保存します

    \b
    - DynamoDBからカメラ情報とコレクター設定を取得
    - カメラタイプに応じて処理を分岐（Kinesis/VSaaS対応）
    - HLS URLを取得してストリーミング処理を実行
    - 設定された間隔で画像をキャプチャしてS3に保存
    - 設定変更時はAPIがECSタスクを停止し、サービスが自動的に再起動
    - エラー発生時は5秒待機後に再試行（再接続対応）
    """
    # エラーが発生しても再試行を繰り返す無限ループ
    # 設定変更時はAPIがECSタスクを停止し、サービスが自動的にタスクを再起動する
    while True:
        try:
            logger.info(f"HLS処理を開始します: カメラID={camera_id}")
            # intervalとdurationは関数内でDBから取得されるため、ダミー値を渡す
            process_hls_stream(camera_id, 0, 0, bucket_name)
            logger.info("処理が正常に完了しました。")
            logger.info(f"{RETRY_WAIT_SEC}秒待機後、処理を再開します...")
            time.sleep(RETRY_WAIT_SEC)
            
        except Exception as e:
            logger.error(f"エラーが発生しました: {e}")
            logger.info(f"{RETRY_WAIT_SEC}秒待機後、処理を再試行します...")
            time.sleep(RETRY_WAIT_SEC)


if __name__ == "__main__":
    streaming()

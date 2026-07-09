package com.lyftr.phone.sync

import android.content.Context
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.lyftr.shared.WearPaths
import com.lyftr.shared.WearSession
import kotlinx.coroutines.tasks.await

private const val FIELD_ACTIVE = "active"
private const val FIELD_SESSION_JSON = "session_json"
private const val FIELD_UPDATED_AT = "updated_at"

/** Publishes the current session to the paired watch over the Data Layer. */
class WearBridge(context: Context) {
    private val dataClient = Wearable.getDataClient(context.applicationContext)

    suspend fun publish(session: WearSession?) {
        val request = PutDataMapRequest.create(WearPaths.SESSION).apply {
            dataMap.putBoolean(FIELD_ACTIVE, session != null)
            dataMap.putString(FIELD_SESSION_JSON, session?.toJson() ?: "")
            dataMap.putLong(FIELD_UPDATED_AT, System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        runCatching { dataClient.putDataItem(request).await() }
    }
}
